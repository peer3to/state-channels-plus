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
import { Hash, Signature, Timestamp } from "@/types/types";
import { DetachedPromises, getChecksumAddress } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { EventBarrierCapturedError } from "@/utils/EventBarrier";

/**
 * Value returned by the responder from `onInitHandshakeRequest` and resolved to
 * the challenger's `.request(...)` call. Replaces the old standalone
 * `onInitHandshakeResponse` endpoint.
 */
export type HandshakeResponse = {
    signature: Signature;
    responseTime: Timestamp;
    preferredTransport: TransportType;
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

    timeoutManager: TimeoutManager;

    // Transports with an in-flight handshake negotiation (challenge sent and
    // awaiting response, or response sent and awaiting ack). Lets `isNegotiating`
    // gate guarded RPCs while the handshake is still completing. The challenge
    // itself now lives in the initiator's `runHandshake` closure, so no shared
    // challenge map is needed.
    private inFlightHandshakeTransports: WeakSet<ATransport> = new WeakSet();

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

    // Called locally to initiate the handshake. Fire-and-forget entry point; the
    // request/response exchange runs in `runHandshake`.
    public initHandshake(transport: ATransport) {
        void this.runHandshake(transport);
    }

    private async runHandshake(transport: ATransport): Promise<void> {
        const randomChallengeHash = ethers.keccak256(ethers.randomBytes(32));
        const initTime = Clock.getTimeInSeconds();
        const agreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "send",
            message: "request",
            challengeHash: randomChallengeHash,
            messageTime: initTime
        });
        this.markHandshakeInFlight(transport);

        // Request/response: send the challenge and await the signed response.
        // A timeout/rejection means no valid response arrived -> disconnect.
        let response: HandshakeResponse;
        try {
            response = await this.remoteRpc.initHandshakeService
                .onInitHandshakeRequest(randomChallengeHash, initTime)
                .request(transport, { timeoutMs: agreementTime * 1000 });
        } catch (error) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: "response-timeout",
                challengeHash: randomChallengeHash,
                challengeInitTime: initTime,
                reason:
                    error instanceof Error
                        ? `handshake response not received in time: ${error.message}`
                        : "handshake response not received in time"
            });
            this.p2pManager.disconnectConnection(transport);
            return;
        }

        // Processing verifies a peer-supplied signature; junk (e.g. a malformed
        // signature) makes `ethers.verifyMessage` throw. Guard it so a bad
        // response disconnects the peer instead of escaping as an unhandled
        // rejection from this background task.
        try {
            await this.handleHandshakeResponse(
                transport,
                randomChallengeHash,
                initTime,
                response
            );
        } catch (error) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: "rejected",
                challengeHash: randomChallengeHash,
                challengeInitTime: initTime,
                reason:
                    error instanceof Error
                        ? `invalid handshake response: ${error.message}`
                        : "invalid handshake response"
            });
            this.p2pManager.disconnectConnection(transport);
        }
    }

    /**
     * Validates and applies a handshake response received via `.request(...)`.
     * Was the body of the old `onInitHandshakeResponse` endpoint; the challenge
     * now comes from the initiator's closure instead of a shared map.
     */
    private async handleHandshakeResponse(
        transport: ATransport,
        challengeHash: string,
        initTime: number,
        response: HandshakeResponse
    ): Promise<void> {
        const { signature, responseTime, preferredTransport } = response;
        const localTime = Clock.getTimeInSeconds();
        const rtt = localTime - initTime;
        const agreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        if (rtt > agreementTime) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "receive",
                message: "rejected",
                challengeHash,
                challengeInitTime: initTime,
                responseTime,
                preferredTransport,
                rttSeconds: rtt,
                timeDifferenceSeconds: rtt,
                absoluteTimeDifferenceSeconds: Math.abs(rtt),
                agreementTimeSeconds: agreementTime,
                reason: "response RTT outside agreement window"
            });
            this.p2pManager.disconnectConnection(transport);
            return;
        }
        const responseTimeDifference = responseTime - initTime;
        if (Math.abs(responseTimeDifference) > agreementTime) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "receive",
                message: "rejected",
                challengeHash,
                challengeInitTime: initTime,
                responseTime,
                preferredTransport,
                rttSeconds: rtt,
                timeDifferenceSeconds: responseTimeDifference,
                absoluteTimeDifferenceSeconds: Math.abs(responseTimeDifference),
                agreementTimeSeconds: agreementTime,
                reason: "response timestamp outside agreement window"
            });
            this.p2pManager.disconnectConnection(transport);
            return;
        }
        //verify signature
        const challengeMessage =
            InitHandshakeService.buildHandshakeChallengeMessage(challengeHash);
        const signerAddress = ethers.verifyMessage(challengeMessage, signature);
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "receive",
            message: "response",
            challengeHash,
            challengeInitTime: initTime,
            responseTime,
            preferredTransport,
            rttSeconds: rtt,
            signerAddress
        });
        // Check if this peer is blacklisted
        // TODO - we destory the profile, so we wouldn't have this information
        if (this.p2pManager.isBlacklisted(signerAddress)) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: "rejected",
                challengeHash,
                challengeInitTime: initTime,
                responseTime,
                preferredTransport,
                rttSeconds: rtt,
                signerAddress,
                reason: "response signer is blacklisted"
            });
            this.p2pManager.disconnectConnection(transport);
            return;
        }

        this.recordVerifiedPeerAddress(transport, signerAddress);

        this.setRemotePreferredTransport(transport, preferredTransport);

        void this.maybeFinalizeHandshakeOnceFromTransport(transport);

        // Inform the remote that we've authenticated them.
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "send",
            message: "ack",
            challengeHash,
            signerAddress
        });
        this.remoteRpc.initHandshakeService
            .onInitHandshakeAck(challengeHash)
            .sendOne(transport);

        // Ensure we have a timeout path in case ack gets lost.
        this.ensureHandshakeAckTimeoutScheduled(transport);
    }

    public markHandshakeInFlight(transport: ATransport) {
        this.inFlightHandshakeTransports.add(transport);
    }

    public isNegotiating(transport: ATransport): boolean {
        return (
            this.inFlightHandshakeTransports.has(transport) ||
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
        const stateManager = this.p2pManager.stateManager;
        if (stateManager.isDisposed) return;

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
        this.inFlightHandshakeTransports.delete(transport);

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
            void this.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                transport
            );
        }

        const isChannelOpenedStatus =
            stateManager.getStatus() === Status.OPENED;
        let isPeerParticipant: boolean;
        try {
            isPeerParticipant =
                await stateManager.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                    stateManager.getChannelId(),
                    completedPeerAddress
                );
        } catch (error) {
            if (stateManager.isDisposed) {
                this.logger.debug(
                    "Skipping finalized handshake after state manager disposal"
                );
                return;
            }
            throw error;
        }
        if (stateManager.isDisposed) return;

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
