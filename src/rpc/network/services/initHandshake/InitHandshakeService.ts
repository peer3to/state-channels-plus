import InitHandshakeRpcMethods from "./InitHandshakeRpcMethods";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import {
    getRpcRequestFailureCause,
    type RpcRequestFailureCause
} from "@/rpc/router/ARpcRouter";
import NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";
import { Hash, Signature, Timestamp } from "@/types/types";
import { DetachedPromises, getChecksumAddress } from "@/utils";
import EventBarrier from "@/utils/EventBarrier";
import { EventBarrierCapturedError } from "@/utils/EventBarrier";
import {
    type InitHandshakeMessage,
    LoggerUtils
} from "@/utils/LoggerUtils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { ethers } from "ethers";

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

/**
 * How the request leg ended when it did not produce a response. A timeout or a
 * refusal is our own filter firing, so we suspend; a transport that is already
 * gone, or a send that never left, has no peer left to suspend.
 */
const REQUEST_FAILURE_LOG_MESSAGE: Record<
    RpcRequestFailureCause,
    InitHandshakeMessage
> = {
    "request-timeout": "response-timeout",
    "remote-error": "response-refused",
    "transport-closed": "transport-closed",
    "send-failed": "response-send-failed"
};

class InitHandshakeService extends ANetworkRpcService<InitHandshakeRpcMethods> {
    /**
     * Domain tag scoping a handshake signature to the handshake protocol.
     * The responder signs this string, never the bare 32-byte challenge hash.
     * Blocks/protocol messages are EIP-191 signatures over a raw 32-byte keccak
     * hash, so signing a domain-tagged string makes a handshake signature
     * structurally incapable of colliding with a block signature — closing the
     * pre-auth signing-oracle (challengeHash = keccak256(encodedBlock)).
     */
    public static readonly HANDSHAKE_DOMAIN = "peer3:init-handshake:v1";

    timeoutManager: TimeoutManager;

    // Transports with an in-flight handshake negotiation (challenge sent and
    // awaiting response, or response sent and awaiting ack). Lets `isNegotiating`
    // gate guarded RPCs while the handshake is still completing. The challenge
    // itself now lives in the initiator's `runHandshake` closure, so no shared
    // challenge map is needed.
    private inFlightHandshakeTransports: WeakSet<NetworkTransport> =
        new WeakSet();

    // Internal ack map: tracks whether we received the handshake ack on a transport.
    // Needed because ack can arrive before we have verified/created a PeerProfile.
    private ackedTransports: WeakSet<NetworkTransport> = new WeakSet();
    private ackTimeoutScheduled: WeakSet<NetworkTransport> = new WeakSet();
    private remotePreferredTransportMap: WeakMap<
        NetworkTransport,
        TransportType
    > = new WeakMap();

    private verifiedPeerAddressByTransport: WeakMap<NetworkTransport, string> =
        new WeakMap();

    private readonly handshakeBarrier: EventBarrier;

    /**
     * Canonical message both peers sign/verify for a given challenge. Uses
     * `hexlify` so requester (locally generated) and responder (wire) derive an
     * identical string regardless of input casing/representation.
     */
    public static buildHandshakeChallengeMessage(challengeHash: Hash): string {
        return `${InitHandshakeService.HANDSHAKE_DOMAIN}:${ethers.hexlify(challengeHash)}`;
    }

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "InitHandshakeService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
        this.handshakeBarrier = new EventBarrier(this.logger);
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): InitHandshakeRpcMethods {
        return new InitHandshakeRpcMethods(transport, this);
    }

    // Called locally to initiate the handshake. Fire-and-forget entry point; the
    // request/response exchange runs in `runHandshake`.
    public initHandshake(transport: NetworkTransport) {
        void this.runHandshake(transport);
    }

    private async runHandshake(transport: NetworkTransport): Promise<void> {
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
            const cause = getRpcRequestFailureCause(error);
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: cause
                    ? REQUEST_FAILURE_LOG_MESSAGE[cause]
                    : "response-timeout",
                challengeHash: randomChallengeHash,
                challengeInitTime: initTime,
                reason:
                    error instanceof Error ? error.message : String(error)
            });
            // Nothing is left to suspend once the connection is gone or the
            // request never left this node.
            if (cause === "transport-closed" || cause === "send-failed") return;
            this.p2pManager.disconnectAndSuspendPeer(transport);
            return;
        }

        // Processing verifies a peer-supplied signature; junk (e.g. a malformed
        // signature) makes `ethers.verifyMessage` throw. Guard it so a bad
        // response rejects the attributable peer instead of escaping as an
        // unhandled rejection from this background task.
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
            this.p2pManager.disconnectAndBlacklistPeer(transport);
        }
    }

    /**
     * Validates and applies a handshake response received via `.request(...)`.
     * Was the body of the old `onInitHandshakeResponse` endpoint; the challenge
     * now comes from the initiator's closure instead of a shared map.
     */
    private async handleHandshakeResponse(
        transport: NetworkTransport,
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
            // Too much latency for the agreement window: not a fault, but we
            // stop dialling this peer for the rest of this runtime.
            this.p2pManager.disconnectAndSuspendPeer(transport);
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
            // Same class as the RTT check: a skewed clock is an environment
            // fault, so suspend instead of punishing the peer.
            this.p2pManager.disconnectAndSuspendPeer(transport);
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
        // A suspended identity is refused like a blacklisted one. Re-apply the
        // suspension to the connection that just arrived, otherwise its fresh
        // peer info stays unbanned and the peer redials.
        if (this.p2pManager.isSuspended(signerAddress)) {
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: "rejected",
                challengeHash,
                challengeInitTime: initTime,
                responseTime,
                preferredTransport,
                rttSeconds: rtt,
                signerAddress,
                reason: "response signer is suspended"
            });
            this.p2pManager.disconnectAndSuspendPeer(transport);
            return;
        }
        // Check if this peer is blacklisted
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

    public markHandshakeInFlight(transport: NetworkTransport) {
        this.inFlightHandshakeTransports.add(transport);
    }

    public isNegotiating(transport: NetworkTransport): boolean {
        return (
            this.inFlightHandshakeTransports.has(transport) ||
            this.remotePreferredTransportMap.has(transport) ||
            this.verifiedPeerAddressByTransport.has(transport) ||
            this.didReceiveAck(transport)
        );
    }

    public recordVerifiedPeerAddress(
        transport: NetworkTransport,
        peerAddress: string
    ) {
        // Boundary: peerAddress may come from non-ethers sources; canonicalize once.
        const checksummed = getChecksumAddress(peerAddress);
        this.verifiedPeerAddressByTransport.set(transport, checksummed);
    }

    public isHandshakeCompletedForTransport(
        transport: NetworkTransport
    ): boolean {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        const isCompleted = transport.peerAddress !== undefined;

        const transportMeta = LoggerUtils.getTransportMetadata(transport);
        this.logger.verbose(
            `Checking if handshake completed for transport ${TransportType[transport.transportType]}`,
            { ...transportMeta, isCompleted, profileExists: !!profile }
        );

        return isCompleted;
    }

    public async waitForHandshakeCompleted(
        transport: NetworkTransport,
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

    public markAcked(transport: NetworkTransport) {
        this.ackedTransports.add(transport);
    }

    public didReceiveAck(transport: NetworkTransport): boolean {
        return this.ackedTransports.has(transport);
    }

    public setRemotePreferredTransport(
        transport: NetworkTransport,
        remotePreferredTransport: TransportType
    ) {
        this.remotePreferredTransportMap.set(
            transport,
            remotePreferredTransport
        );
    }

    public ensureHandshakeAckTimeoutScheduled(transport: NetworkTransport) {
        if (this.ackTimeoutScheduled.has(transport)) return;
        this.ackTimeoutScheduled.add(transport);

        this.timeoutManager.scheduleTask(
            () => {
                if (this.didReceiveAck(transport)) return;
                // Handshake negotiation started but never finalized. A missing
                // ack is a load/clock symptom, not misbehaviour, so close and
                // suspend by transport — the verified address may have no
                // profile yet, and blacklisting by it never closed anything.
                // The address is kept for the log only.
                const peerAddress =
                    transport.peerAddress ||
                    this.verifiedPeerAddressByTransport.get(transport);

                LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                    direction: "local",
                    message: "ack-timeout",
                    verifiedPeerAddress: peerAddress,
                    reason: "handshake ack not received in time"
                });

                this.p2pManager.disconnectAndSuspendPeer(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "InitHandshakeService - handshake ack timeout"
        );
    }

    /**
     * Close and suspend once the refusal we are about to throw has been sent.
     * The reply is written from the rejection's microtask chain, so a
     * zero-delay task is the first point after it reaches the wire.
     */
    public suspendAfterRefusal(transport: NetworkTransport) {
        this.timeoutManager.scheduleTask(
            () => this.p2pManager.disconnectAndSuspendPeer(transport),
            0,
            "InitHandshakeService - suspend after handshake refusal"
        );
    }

    public async maybeFinalizeHandshakeOnceFromTransport(
        transport: NetworkTransport
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

        const profile = this.p2pManager.profileManager.authenticateTransport(
            transport,
            verifiedPeerAddress
        );
        if (!profile) {
            this.inFlightHandshakeTransports.delete(transport);
            LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
                direction: "local",
                message: "rejected",
                verifiedPeerAddress,
                didReceiveAck: true,
                remotePreferred
            });
            return;
        }

        this.inFlightHandshakeTransports.delete(transport);

        const completedPeerAddress = verifiedPeerAddress.toString();
        LoggerUtils.logInitHandshakeMessage(this.logger, transport, {
            direction: "local",
            message: "completed",
            verifiedPeerAddress: completedPeerAddress,
            didReceiveAck: true,
            remotePreferred
        });

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

        // P2PManager owns post-handshake routing for the current local status.
        this.p2pManager.stateManager.p2pEventHooks.handshakeCompleted?.(
            completedPeerAddress
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
