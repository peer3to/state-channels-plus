import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport, WebRTCTransport } from "@/transport";
// @ts-expect-error - get-webrtc doesn't ship TypeScript declarations
import { RTCPeerConnection, RTCIceCandidate } from "get-webrtc";

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
            const connection = new RTCPeerConnection();
            const peerAddress = this.senderTransport.peerAddress;
            if (!peerAddress) {
                this.service.logger.error(
                    `onOfferWebRTC - missing peer address`
                );
                return;
            }

            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    this.remoteRpc.webRTCSetupService
                        .onIceCandidate(serializedCandidate)
                        .sendOne(peerAddress);
                }
            };
            connection.ondatachannel = (event: any) => {
                new WebRTCTransport(event.channel, this.p2pManager);
            };
            this.service.connectionMap.set(peerAddress, connection);

            this.service.setupConnectionStateHandlers(connection, peerAddress);
            const offer = JSON.parse(serializedOffer);
            await connection.setRemoteDescription(offer);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
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
            const connection = this.service.connectionMap.get(peerAddress);
            if (!connection) return;
            const answer = JSON.parse(serializedAnswer);
            await connection.setRemoteDescription(answer);
        } catch (e) {
            this.service.logger.verbose("onAnswerWebRTC - error", e);
        }
    }

    // Handle ICE candidates
    public async onIceCandidate(serializedCandidate: string) {
        try {
            const candidate = new RTCIceCandidate(
                JSON.parse(serializedCandidate)
            );
            const peerAddress = this.senderTransport.peerAddress;
            if (!peerAddress) {
                this.service.logger.error(
                    `onIceCandidate - missing peer address`
                );
                return;
            }

            const connection = this.service.connectionMap.get(peerAddress);
            if (!connection)
                return this.service.logger.error(
                    `onIceCandidate - no connection`
                );

            await connection.addIceCandidate(candidate);
        } catch (error) {
            this.service.logger.verbose("onIceCandidate - error", error);
        }
    }
}

export default WebRTCSetupRpcMethods;
