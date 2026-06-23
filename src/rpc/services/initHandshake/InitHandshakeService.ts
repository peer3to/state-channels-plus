import { ethers } from "ethers";
import ARpcService from "@/rpc/ARpcService";
import Clock from "@/Clock";

import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";
import PeerProfile from "@/PeerProfile";
import InitHandshakeRpcMethods from "./InitHandshakeRpcMethods";
import type P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";
import EventBarrier from "@/utils/EventBarrier";
import { Status } from "@/types";
import { Hash } from "@/types/types";
import { DetachedPromises, getChecksumAddress } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { EventBarrierCapturedError } from "@/utils/EventBarrier";

type ConnectionChallenge = {
    randomChallengeHash: string;
    initTime: number;
};

class InitHandshakeService extends ARpcService<InitHandshakeRpcMethods> {
    /**
     * Domain tag scoping a handshake signature to the handshake protocol.
     * The responder signs this string, never the bare 32-byte challenge hash.
     * Blocks/protocol messages are EIP-191 signatures over a raw 32-byte keccak
     * hash, so signing a domain-tagged string makes a handshake signature
     * structurally incapable of colliding with a block signature — closing the
     * pre-auth signing-oracle (challengeHash = keccak256(encodedBlock)).
     */
    public static readonly HANDSHAKE_DOMAIN = "peer3:init-handshake:v1";

    /**
     * Canonical message both peers sign/verify for a given challenge. Uses
     * `hexlify` so requester (locally generated) and responder (wire) derive an
     * identical string regardless of input casing/representation.
     */
    public static buildHandshakeChallengeMessage(challengeHash: Hash): string {
        return `${InitHandshakeService.HANDSHAKE_DOMAIN}:${ethers.hexlify(challengeHash)}`;
    }

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
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "send",
            message: "request",
            challengeHash: randomChallengeHash,
            messageTime: time
        });
        this.remoteRpc.initHandshakeService
            .onInitHandshakeRequest(randomChallengeHash, time)
            .sendOne(transport);
        // expect a response or disconnect
        this.timeoutManager.scheduleTask(
            () => {
                if (!this.didRespond(transport)) {
                    const challenge = this.getChallenge(transport);
                    LoggerUtils.logInitHandshakeMessage(
                        this.logger,
                        transport,
                        {
                            direction: "local",
                            message: "response-timeout",
                            challengeHash: challenge?.randomChallengeHash,
                            challengeInitTime: challenge?.initTime,
                            reason: "handshake response not received in time"
                        }
                    );
                    this.p2pManager.disconnectConnection(transport);
                }
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
        // Boundary: peerAddress may come from non-ethers sources; canonicalize once.
        const checksummed = getChecksumAddress(peerAddress);
        this.verifiedPeerAddressByTransport.set(transport, checksummed);
        transport.peerAddress = checksummed;
    }

    public isHandshakeCompletedForTransport(transport: ATransport): boolean {
        const address = transport.peerAddress;
        const profileManager = this.p2pManager.profileManager;
        const profile = address
            ? profileManager.getProfileByEvmAddress(address)
            : profileManager.getProfileByTransport(transport);

        const isCompleted = !!profile && profile.getIsHandshakeCompleted();

        const transportMeta = LoggerUtils.getTransportMetadata(transport);
        this.logger.verbose(
            `Checking if handshake completed for transport ${TransportType[transport.transportType]}`,
            { ...transportMeta, isCompleted, profileExists: !!profile }
        );

        return isCompleted;
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
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.logger.verbose("waitForHandshakeCompleted failed", {
                error,
                capturedBarrierStack: barrierError.capturedBarrierStack,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
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
                // Handshake negotiation started but never finalized.
                // If we have an authenticated peer address, blacklist by address;
                // otherwise just disconnect the transport.
                const peerAddress =
                    transport.peerAddress ||
                    this.verifiedPeerAddressByTransport.get(transport);

                LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                    direction: "local",
                    message: "ack-timeout",
                    verifiedPeerAddress: peerAddress,
                    reason: "handshake ack not received in time"
                });

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

    public async maybeFinalizeHandshakeOnceFromTransport(
        transport: ATransport
    ) {
        const verifiedPeerAddress =
            this.verifiedPeerAddressByTransport.get(transport);
        const didReceiveAck = this.didReceiveAck(transport);
        const remotePreferred = this.remotePreferredTransportMap.get(transport);
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "local",
            message: "finalize-check",
            verifiedPeerAddress,
            didReceiveAck,
            remotePreferred
        });

        if (!verifiedPeerAddress) return;
        if (!this.didReceiveAck(transport)) return;
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

        const completedPeerAddress = profile.getEvmAddress().toString();
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "local",
            message: "completed",
            verifiedPeerAddress: completedPeerAddress,
            didReceiveAck: true,
            remotePreferred
        });

        // Only treat the transport as an "open connection" after handshake is final.
        this.p2pManager.addConnection(transport);

        const localAddress = this.p2pManager.p2pSigner.signerAddress.toString();

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
        const isChannelOpenedStatus =
            stateManager.getStatus() === Status.OPENED;
        const isPeerParticipant =
            await stateManager.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                stateManager.getChannelId(),
                completedPeerAddress
            );

        if (isChannelOpenedStatus) {
            if (isPeerParticipant) {
                this.logger.debug(
                    `Initiating sync after handshake with peer ${completedPeerAddress}`
                );
                this.p2pManager.localRpc.spectateService.sync(
                    completedPeerAddress,
                    stateManager.getChannelId()
                );
            } else {
                this.logger.debug(
                    `Skipping sync after handshake with peer ${completedPeerAddress} - not a participant`
                );
            }
        }

        this.p2pManager.stateManager.p2pEventHooks.onConnection?.(
            completedPeerAddress,
            isChannelOpenedStatus
        );

        // Allow guards to return early once handshake completes.
        const transportMeta = LoggerUtils.getTransportMetadata(transport);
        this.logger.verbose(
            `Signaling handshake completion for transport ${TransportType[transport.transportType]}`,
            { ...transportMeta }
        );
        DetachedPromises.collect(this.handshakeBarrier.signal());
    }
}

export default InitHandshakeService;
