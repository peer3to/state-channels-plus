import { ethers } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import Clock from "@/Clock";

import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";
import PeerProfile from "@/PeerProfile";
import { Hash, Signature, Timestamp } from "@/types/types";
import InitHandshakeRpcMethods from "./InitHandshakeRpcMethods";
import type P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";
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
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "InitHandshakeService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
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
                // If we already saw an ack on this transport, we're good.
                if (this.didReceiveAck(transport)) return;

                const profile =
                    this.p2pManager.profileManager.getProfileByTransport(
                        transport
                    );
                if (!profile) return;
                if (profile.getIsHandshakeCompleted()) return;
                this.p2pManager.disconnectAndBlacklistPeer(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "InitHandshakeService - handshake ack timeout"
        );
    }

    public maybeFinalizeHandshakeOnceFromTransport(transport: ATransport) {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        if (!profile) return;
        if (!this.didReceiveAck(transport)) return;

        const remotePreferred = this.remotePreferredTransportMap.get(transport);
        if (remotePreferred === undefined) return;

        if (profile.getIsHandshakeCompleted()) return;

        profile.setIsHandshakeCompleted(true);

        const peerAddress = profile.getEvmAddress().toString().toLowerCase();
        this.logger.debug(
            `Handshake completed with peer ${peerAddress} over transport ${TransportType[transport.transportType]}`
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
            localAddress < peerAddress;

        if (shouldInitiateWebRTC) {
            this.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                transport
            );
        }

        const stateManager = this.p2pManager.stateManager;
        if (stateManager.getStatus() === Status.OPENED) {
            this.logger.debug(
                `Initiating sync after handshake with peer ${peerAddress}`
            );
            this.p2pManager.localRpc.spectateService.sync(
                peerAddress,
                stateManager.getChannelId()
            );
        }

        this.p2pManager.stateManager.p2pEventHooks.onConnection?.(peerAddress);
    }
}

export default InitHandshakeService;
