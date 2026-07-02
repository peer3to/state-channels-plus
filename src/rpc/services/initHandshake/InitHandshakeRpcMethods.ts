import Clock from "@/Clock";
import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import { Hash, Timestamp } from "@/types/types";
import { ethers } from "ethers";
import InitHandshakeService, {
    HandshakeResponse
} from "./InitHandshakeService";
import { LoggerUtils } from "@/utils/LoggerUtils";

class InitHandshakeRpcMethods extends ARpcMethods {
    service: InitHandshakeService;
    constructor(transport: ATransport, service: InitHandshakeService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    /**
     * Request/response: the challenger sends its challenge and awaits the signed
     * response directly (`.request(...)`). The signed challenge + responder's
     * preferred transport are returned to the caller rather than delivered via a
     * separate `onInitHandshakeResponse` endpoint. A thrown error rejects the
     * caller's request and tears down the connection on both ends.
     */
    public async onInitHandshakeRequest(
        challengeHash: Hash,
        time: Timestamp
    ): Promise<HandshakeResponse> {
        const localTime = Clock.getTimeInSeconds();
        const agreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        LoggerUtils.logInitHandshakeMessage(
            this.service.logger,
            this.senderTransport,
            {
                direction: "receive",
                message: "request",
                challengeHash,
                messageTime: time
            }
        );
        // Reject malformed inputs before signing. A non-32-byte challenge or a
        // non-numeric time (NaN slips past the skew check below) would let a
        // peer steer what gets signed.
        if (!ethers.isHexString(challengeHash, 32) || !Number.isFinite(time)) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "local",
                    message: "rejected",
                    challengeHash,
                    messageTime: time,
                    reason: "malformed handshake request (challenge/time)"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            throw new Error("malformed handshake request (challenge/time)");
        }
        const timeDifference = time - localTime;
        if (Math.abs(timeDifference) > agreementTime) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "local",
                    message: "rejected",
                    challengeHash,
                    messageTime: time,
                    timeDifferenceSeconds: timeDifference,
                    absoluteTimeDifferenceSeconds: Math.abs(timeDifference),
                    agreementTimeSeconds: agreementTime,
                    reason: "request time outside agreement window"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            throw new Error("request time outside agreement window");
        }
        const challengeMessage =
            InitHandshakeService.buildHandshakeChallengeMessage(challengeHash);
        const signature =
            await this.p2pManager.p2pSigner.signMessage(challengeMessage);
        LoggerUtils.logInitHandshakeMessage(
            this.service.logger,
            this.senderTransport,
            {
                direction: "send",
                message: "response",
                challengeHash,
                responseTime: localTime,
                preferredTransport: this.p2pManager.preferredTransport
            }
        );
        // We've authenticated their challenge and replied; from here we expect
        // their ack. Mark the negotiation and arm the ack timeout.
        this.service.markHandshakeInFlight(this.senderTransport);
        this.service.ensureHandshakeAckTimeoutScheduled(this.senderTransport);
        return {
            signature,
            responseTime: localTime,
            preferredTransport: this.p2pManager.preferredTransport
        };
    }

    /**
     * Sent after a peer verifies our handshake response. We only treat the handshake
     * as complete once we have both: (1) verified the remote, and (2) received this ack.
     *
     * `challengeHash` is a diagnostic correlation id only — it lets a single log
     * stream be followed across the two threads/peers. It is NOT an authenticity
     * check and MUST NOT be trusted for any decision: peer authenticity is
     * established solely by signature verification in `onInitHandshakeResponse`.
     */
    public async onInitHandshakeAck(challengeHash?: Hash) {
        LoggerUtils.logInitHandshakeMessage(
            this.service.logger,
            this.senderTransport,
            {
                direction: "receive",
                message: "ack",
                challengeHash
            }
        );
        if (this.service.didReceiveAck(this.senderTransport)) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "local",
                    message: "ack",
                    challengeHash,
                    reason: "duplicate handshake ack"
                }
            );
            this.p2pManager.disconnectAndBlacklistPeer(
                this.senderTransport,
                "protocol violation: duplicate handshake ack"
            );
            return;
        }

        // Ack may arrive before we have verified the remote (simultaneous initiation).
        // Record it on the transport and apply it to the profile once available.
        this.service.markAcked(this.senderTransport);

        this.service.maybeFinalizeHandshakeOnceFromTransport(
            this.senderTransport
        );
    }
}

export default InitHandshakeRpcMethods;
