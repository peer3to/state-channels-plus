import { ethers } from "ethers";
import ARpcService from "@/rpc/ARpcService";
import MainRpcService from "@/rpc/MainRpcService";
import Clock from "@/Clock";

import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";
import PeerProfile from "@/PeerProfile";
import { Hash, Signature, Timestamp } from "@/types/types";
import InitHandshakeRpcMethods from "./InitHandshakeRpcMethods";
import type P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";
import EventBarrier from "@/utils/EventBarrier";
import { Status } from "@/types";

type ConnectionChallenge = {
    randomChallengeHash: string;
    initTime: number;
};

class InitHandshakeService extends ARpcService<InitHandshakeRpcMethods> {
    mapTransportToChallenge: WeakMap<ATransport, ConnectionChallenge> =
        new WeakMap<ATransport, ConnectionChallenge>();
    timeoutManager: TimeoutManager;

    // Internal ack map: tracks whether we received the handshake ack on a transport.
    // Needed because ack can arrive before we have verified/created a PeerProfile.
    private ackedTransports: WeakSet<ATransport> = new WeakSet();
    private ackTimeoutScheduled: WeakSet<ATransport> = new WeakSet();
    private remotePreferredTransportMap: WeakMap<ATransport, TransportType> =
        new WeakMap();

    private verifiedPeerAddressByTransport: WeakMap<ATransport, string> =
        new WeakMap();

    private readonly handshakeBarrier: EventBarrier;
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "InitHandshakeService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
        this.handshakeBarrier = new EventBarrier(this.logger);
    }

    public createRPCMethods(transport: ATransport): InitHandshakeRpcMethods {
        return new InitHandshakeRpcMethods(transport, this);
    }

    //Called locally to initiate the handshake
    public initHandshake(transport: ATransport) {
        const randomChallengeHash = ethers.keccak256(ethers.randomBytes(32));
        const time = Clock.getTimeInSeconds();
        this.setChallenge(transport, { randomChallengeHash, initTime: time });
        this.remoteRpc.initHandshakeService
            .onInitHandshakeRequest(randomChallengeHash, time)
            .sendOne(transport);
        // expect a response or disconnect
        this.timeoutManager.scheduleTask(
            () => {
                if (!this.didRespond(transport))
                    this.p2pManager.disconnectConnection(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "InitHandshakeService - initHandshake timeout"
        );
    }

    public setChallenge(transport: ATransport, challenge: ConnectionChallenge) {
        this.mapTransportToChallenge.set(transport, challenge);
    }

    public getChallenge(
        transport: ATransport
    ): ConnectionChallenge | undefined {
        return this.mapTransportToChallenge.get(transport);
    }

    public didRespond(transport: ATransport): boolean {
        return !this.getChallenge(transport);
    }

    public isNegotiating(transport: ATransport): boolean {
        return (
            this.mapTransportToChallenge.has(transport) ||
            this.remotePreferredTransportMap.has(transport) ||
            this.verifiedPeerAddressByTransport.has(transport) ||
            this.didReceiveAck(transport)
        );
    }

    public recordVerifiedPeerAddress(
        transport: ATransport,
        peerAddress: string
    ) {
        const normalized = peerAddress.toLowerCase();
        this.verifiedPeerAddressByTransport.set(transport, normalized);
        transport.peerAddress = normalized;
    }

    public isHandshakeCompletedForTransport(transport: ATransport): boolean {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        return !!profile && profile.getIsHandshakeCompleted();
    }

    public async waitForHandshakeCompleted(
        transport: ATransport,
        timeoutMs: number
    ): Promise<boolean> {
        try {
            await this.handshakeBarrier.waitFor(
                () => this.isHandshakeCompletedForTransport(transport),
                {
                    timeoutMs,
                    timeoutMessage: "Handshake did not complete in time",
                    label: "InitHandshakeService.waitForHandshakeCompleted"
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    public markAcked(transport: ATransport) {
        this.ackedTransports.add(transport);
    }

    public didReceiveAck(transport: ATransport): boolean {
        return this.ackedTransports.has(transport);
    }

    public setRemotePreferredTransport(
        transport: ATransport,
        remotePreferredTransport: TransportType
    ) {
        this.remotePreferredTransportMap.set(
            transport,
            remotePreferredTransport
        );
    }

    public ensureHandshakeAckTimeoutScheduled(transport: ATransport) {
        if (this.ackTimeoutScheduled.has(transport)) return;
        this.ackTimeoutScheduled.add(transport);

        this.timeoutManager.scheduleTask(
            () => {
                if (this.didReceiveAck(transport)) return;
                this.logger.warn(
                    `Handshake ack not received in time from transport ${TransportType[transport.transportType]}, disconnecting.`
                );
                // Handshake negotiation started but never finalized.
                // If we have an authenticated peer address, blacklist by address;
                // otherwise just disconnect the transport.
                const peerAddress =
                    transport.peerAddress ||
                    this.verifiedPeerAddressByTransport.get(transport);

                if (peerAddress) {
                    this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        peerAddress
                    );
                    return;
                }

                this.p2pManager.disconnectConnection(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "InitHandshakeService - handshake ack timeout"
        );
    }

    public maybeFinalizeHandshakeOnceFromTransport(transport: ATransport) {
        const verifiedPeerAddress =
            this.verifiedPeerAddressByTransport.get(transport);
        if (!verifiedPeerAddress) return;
        if (!this.didReceiveAck(transport)) return;

        const remotePreferred = this.remotePreferredTransportMap.get(transport);
        if (remotePreferred === undefined) return;

        // Only create/update the profile once the handshake has fully completed.
        let profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(
                verifiedPeerAddress
            );
        if (!profile) {
            profile = new PeerProfile(transport, verifiedPeerAddress);
            this.p2pManager.profileManager.registerProfile(profile);
        } else {
            this.p2pManager.profileManager.updateTransport(
                profile.getEvmAddress().toString(),
                transport
            );
        }

        // Ensure the transport always carries the canonical peer address.
        transport.peerAddress = verifiedPeerAddress;

        profile.setIsHandshakeCompleted(true);

        const completedPeerAddress = profile
            .getEvmAddress()
            .toString()
            .toLowerCase();
        this.logger.debug(
            `Handshake completed with peer ${completedPeerAddress} over transport ${TransportType[transport.transportType]}`
        );

        // Only treat the transport as an "open connection" after handshake is final.
        this.p2pManager.addConnection(transport);

        const localAddress = this.p2pManager.p2pSigner.signerAddress
            .toString()
            .toLowerCase();

        const shouldInitiateWebRTC =
            (remotePreferred === TransportType.WEBRTC ||
                this.p2pManager.preferredTransport === TransportType.WEBRTC) &&
            transport.transportType != TransportType.WEBRTC &&
            localAddress < completedPeerAddress;

        if (shouldInitiateWebRTC) {
            this.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                transport
            );
        }

        const stateManager = this.p2pManager.stateManager;
        const isChannelOpened = stateManager.getStatus() === Status.OPENED;
        if (isChannelOpened) {
            this.logger.debug(
                `Initiating sync after handshake with peer ${completedPeerAddress}`
            );
            this.p2pManager.localRpc.spectateService.sync(
                completedPeerAddress,
                stateManager.getChannelId()
            );
        }

        this.p2pManager.stateManager.p2pEventHooks.onConnection?.(
            completedPeerAddress,
            isChannelOpened
        );

        // Allow guards to return early once handshake completes.
        void this.handshakeBarrier.signal();
    }
}

export default InitHandshakeService;
