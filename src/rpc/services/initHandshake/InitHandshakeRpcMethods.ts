import Clock from "@/Clock";
import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport, TransportType } from "@/transport";
import { Hash, Signature, Timestamp } from "@/types/types";
import { ethers } from "ethers";
import InitHandshakeService from "./InitHandshakeService";
import { LoggerUtils } from "@/utils/LoggerUtils";

class InitHandshakeRpcMethods extends ARpcMethods {
    service: InitHandshakeService;
    constructor(transport: ATransport, service: InitHandshakeService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onInitHandshakeRequest(challengeHash: Hash, time: Timestamp) {
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
            return;
        }
        const challengeHashBytes = ethers.getBytes(challengeHash);
        const signature =
            await this.p2pManager.p2pSigner.signMessage(challengeHashBytes);
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
        this.remoteRpc.initHandshakeService
            .onInitHandshakeResponse(
                signature,
                localTime,
                this.p2pManager.preferredTransport
            )
            .sendOne(this.senderTransport);
        this.service.ensureHandshakeAckTimeoutScheduled(this.senderTransport);
    }

    public async onInitHandshakeResponse(
        signature: Signature,
        responseTime: Timestamp,
        preferredTransport: TransportType
    ) {
        const challenge = this.service.getChallenge(this.senderTransport);
        this.service.mapTransportToChallenge.delete(this.senderTransport);
        if (!challenge) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "receive",
                    message: "rejected",
                    responseTime,
                    preferredTransport,
                    reason: "response did not match an active challenge"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }
        const localTime = Clock.getTimeInSeconds();
        const rtt = localTime - challenge.initTime;
        const agreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        if (rtt > agreementTime) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "receive",
                    message: "rejected",
                    challengeHash: challenge.randomChallengeHash,
                    challengeInitTime: challenge.initTime,
                    responseTime,
                    preferredTransport,
                    rttSeconds: rtt,
                    timeDifferenceSeconds: rtt,
                    absoluteTimeDifferenceSeconds: Math.abs(rtt),
                    agreementTimeSeconds: agreementTime,
                    reason: "response RTT outside agreement window"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }
        const responseTimeDifference = responseTime - challenge.initTime;
        if (Math.abs(responseTimeDifference) > agreementTime) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "receive",
                    message: "rejected",
                    challengeHash: challenge.randomChallengeHash,
                    challengeInitTime: challenge.initTime,
                    responseTime,
                    preferredTransport,
                    rttSeconds: rtt,
                    timeDifferenceSeconds: responseTimeDifference,
                    absoluteTimeDifferenceSeconds: Math.abs(
                        responseTimeDifference
                    ),
                    agreementTimeSeconds: agreementTime,
                    reason: "response timestamp outside agreement window"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }
        //verify signature
        const challengeHashBytes = ethers.getBytes(
            challenge.randomChallengeHash
        );
        const signerAddress = ethers.verifyMessage(
            challengeHashBytes,
            signature
        );
        LoggerUtils.logInitHandshakeMessage(
            this.service.logger,
            this.senderTransport,
            {
                direction: "receive",
                message: "response",
                challengeHash: challenge.randomChallengeHash,
                challengeInitTime: challenge.initTime,
                responseTime,
                preferredTransport,
                rttSeconds: rtt,
                signerAddress
            }
        );
        // Check if this peer is blacklisted
        // TODO - we destory the profile, so we wouldn't have this information
        if (this.p2pManager.isBlacklisted(signerAddress)) {
            LoggerUtils.logInitHandshakeMessage(
                this.service.logger,
                this.senderTransport,
                {
                    direction: "local",
                    message: "rejected",
                    challengeHash: challenge.randomChallengeHash,
                    challengeInitTime: challenge.initTime,
                    responseTime,
                    preferredTransport,
                    rttSeconds: rtt,
                    signerAddress,
                    reason: "response signer is blacklisted"
                }
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }

        this.service.recordVerifiedPeerAddress(
            this.senderTransport,
            signerAddress
        );

        this.service.setRemotePreferredTransport(
            this.senderTransport,
            preferredTransport
        );

        this.service.maybeFinalizeHandshakeOnceFromTransport(
            this.senderTransport
        );

        // Inform the remote that we've authenticated them.
        LoggerUtils.logInitHandshakeMessage(
            this.service.logger,
            this.senderTransport,
            {
                direction: "send",
                message: "ack",
                challengeHash: challenge.randomChallengeHash,
                signerAddress
            }
        );
        this.remoteRpc.initHandshakeService
            .onInitHandshakeAck(challenge.randomChallengeHash)
            .sendOne(this.senderTransport);
        //TODO! TEST!!
        // this.rpcProxy
        //     .onSignJoinChannelTEST(
        //         this.p2pManager.p2pSigner.signedJc.encodedJoinChannel,
        //         this.p2pManager.p2pSigner.signedJc.signature
        //     )
        //     .broadcast();

        // Ensure we have a timeout path in case ack gets lost.
        this.service.ensureHandshakeAckTimeoutScheduled(this.senderTransport);
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
