import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";

import WebRTCSetupService from "./WebRTCSetupService";

class WebRTCSetupRpcMethods extends ARpcMethods {
    service: WebRTCSetupService;
    constructor(transport: ATransport, service: WebRTCSetupService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    //Ran by the peer who is responding to the connection - this creates the answer
    public async onOfferWebRTC(serializedOffer: string) {
        try {
            const peerAddress = this.senderTransport.peerAddress;
            if (!peerAddress) {
                this.service.logger.error(
                    `onOfferWebRTC - missing peer address`
                );
                return;
            }

            const offer = JSON.parse(serializedOffer);
            const answer = await this.service.acceptWebRTCOffer(
                peerAddress,
                offer
            );
            const serializedAnswer = JSON.stringify(answer);
            this.remoteRpc.webRTCSetupService
                .onAnswerWebRTC(serializedAnswer)
                .sendOne(peerAddress);
        } catch (e) {
            this.service.logger.verbose("onOfferWebRTC - error", e);
        }
    }

    //Ran by the peer who initiated the connection - this completes the handshake (negotiation)
    public async onAnswerWebRTC(serializedAnswer: string) {
        try {
            const peerAddress = this.senderTransport.peerAddress;
            if (!peerAddress) {
                this.service.logger.error(
                    `onAnswerWebRTC - missing peer address`
                );
                return;
            }
            const answer = JSON.parse(serializedAnswer);
            await this.service.applyWebRTCAnswer(peerAddress, answer);
        } catch (e) {
            this.service.logger.verbose("onAnswerWebRTC - error", e);
        }
    }

    // Handle ICE candidates
    public async onIceCandidate(serializedCandidate: string) {
        try {
            const peerAddress = this.senderTransport.peerAddress;
            if (!peerAddress) {
                this.service.logger.error(
                    `onIceCandidate - missing peer address`
                );
                return;
            }

            const candidate = JSON.parse(serializedCandidate);
            await this.service.addWebRTCIceCandidate(peerAddress, candidate);
        } catch (error) {
            this.service.logger.verbose("onIceCandidate - error", error);
        }
    }
}

export default WebRTCSetupRpcMethods;
