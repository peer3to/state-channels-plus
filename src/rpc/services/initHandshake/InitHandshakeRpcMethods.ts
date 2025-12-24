import Clock from "@/Clock";
import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport, TransportType } from "@/transport";
import { Hash, Signature, Timestamp } from "@/types/types";
import { ethers } from "ethers";
import InitHandshakeService from "./InitHandshakeService";
import PeerProfile from "@/PeerProfile";
import { Status } from "@/types";

class InitHandshakeRpcMethods extends ARpcMethods {
    service: InitHandshakeService;
    constructor(transport: ATransport, service: InitHandshakeService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onInitHandshakeRequest(challengeHash: Hash, time: Timestamp) {
        const localTime = Clock.getTimeInSeconds();
        if (
            Math.abs(time - localTime) >
            this.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            this.p2pManager.disconnectConnection(this.senderTransport);
            this.service.logger.debug(
                `onInitHandshakeRequest - time difference too big - time:${time} localTime:${localTime} diff:${
                    time - localTime
                } agreementTime:${
                    this.p2pManager.stateManager.timeConfig.agreementTime
                }`
            );
            return;
        }
        const challengeHashBytes = ethers.getBytes(challengeHash);
        const signature =
            await this.p2pManager.p2pSigner.signMessage(challengeHashBytes);
        this.remoteRpc.initHandshakeService
            .onInitHandshakeResponse(
                signature,
                localTime,
                this.p2pManager.preferredTransport
            )
            .sendOne(this.senderTransport);
    }

    public async onInitHandshakeResponse(
        signature: Signature,
        responseTime: Timestamp,
        preferredTransport: TransportType
    ) {
        const challenge = this.service.getChallenge(this.senderTransport);
        this.service.mapTransportToChallenge.delete(this.senderTransport);
        if (!challenge) {
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }
        const localTime = Clock.getTimeInSeconds();
        const rtt = localTime - challenge.initTime;
        if (rtt > this.p2pManager.stateManager.timeConfig.agreementTime) {
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }
        if (
            Math.abs(responseTime - challenge.initTime) >
            this.p2pManager.stateManager.timeConfig.agreementTime
        ) {
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

        // Check if this peer is blacklisted
        if (this.p2pManager.isBlacklisted(signerAddress)) {
            this.service.logger.debug(
                `Rejecting handshake from blacklisted peer: ${signerAddress}`
            );
            this.p2pManager.disconnectConnection(this.senderTransport);
            return;
        }

        const normalizedAddress = signerAddress.toLowerCase();

        this.senderTransport.peerAddress = normalizedAddress;

        let profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(
                signerAddress
            );
        if (!profile) {
            profile = new PeerProfile(this.senderTransport, signerAddress);
            this.p2pManager.profileManager.registerProfile(profile);
        } else {
            this.p2pManager.profileManager.updateTransport(
                profile.getEvmAddress().toString(),
                this.senderTransport
            );
        }

        this.service.ensureHandshakeAckTimeoutScheduled(this.senderTransport);
        this.service.setRemotePreferredTransport(
            this.senderTransport,
            preferredTransport
        );

        this.service.maybeFinalizeHandshakeOnceFromTransport(
            this.senderTransport
        );

        // Inform the remote that we've authenticated them.
        this.remoteRpc.initHandshakeService
            .onInitHandshakeAck()
            .sendOne(this.senderTransport);
        //TODO! TEST!!
        // this.rpcProxy
        //     .onSignJoinChannelTEST(
        //         this.p2pManager.p2pSigner.signedJc.encodedJoinChannel,
        //         this.p2pManager.p2pSigner.signedJc.signature
        //     )
        //     .broadcast();
    }

    /**
     * Sent after a peer verifies our handshake response. We only treat the handshake
     * as complete once we have both: (1) verified the remote, and (2) received this ack.
     */
    public async onInitHandshakeAck() {
        if (this.service.didReceiveAck(this.senderTransport)) {
            this.p2pManager.disconnectAndBlacklistPeer(this.senderTransport);
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
