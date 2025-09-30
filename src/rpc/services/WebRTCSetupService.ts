import { ARpcService, MainRpcService } from "@/rpc";
//@ts-ignore
import { RTCPeerConnection } from "get-webrtc";
import WebRTCTransport from "@/transport/WebRTCTransport";

class WebRTCSetupService extends ARpcService {
    connectionMap: Map<string, RTCPeerConnection> = new Map();

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC() {
        //TODO! - require seccusfull init handshake (also on other methods)
        try {
            console.log("initiateWebRTC");
            const connection = new RTCPeerConnection();
            const channel = connection.createDataChannel("webRTC-DataChannel");
            const webRTCTransport = new WebRTCTransport(
                channel,
                this.mainRpcService.p2pManager
            );

            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    this.mainRpcService.rpcProxy
                        .onIceCandidate(serializedCandidate)
                        .sendOne(this.mainRpcService.senderTransport!);
                }
            };

            const senderTransport = this.mainRpcService.senderTransport; // catch it here since async call below
            const offer = await connection.createOffer();
            connection.setLocalDescription(offer);
            const adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            const serializedOffer = JSON.stringify(offer);
            this.mainRpcService.rpcProxy
                .onOfferWebRTC(serializedOffer)
                .sendOne(senderTransport!);
        } catch (e) {
            console.log("initiateWebRTC - error", e);
        }
    }

    //Ran by the peer who is responding to the connection - this creates the answer
    public async onOfferWebRTC(serializedOffer: string) {
        try {
            const connection = new RTCPeerConnection();
            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    this.mainRpcService.rpcProxy
                        .onIceCandidate(serializedCandidate)
                        .sendOne(this.mainRpcService.senderTransport!);
                }
            };
            connection.ondatachannel = (event: any) => {
                console.log("WebRTC - onOfferWebRTC - ondatachannel");
                const webRTCTransport = new WebRTCTransport(
                    event.channel,
                    this.mainRpcService.p2pManager
                );
            };
            const senderTransport = this.mainRpcService.senderTransport; // catch it here since async call below
            const adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            const offer = JSON.parse(serializedOffer);
            console.log("onOfferWebRTC - offer", offer);
            await connection.setRemoteDescription(offer);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            const serializedAnswer = JSON.stringify(answer);
            this.mainRpcService.rpcProxy
                .onAnswerWebRTC(serializedAnswer)
                .sendOne(senderTransport!);
        } catch (e) {
            console.log("onOfferWebRTC - error", e);
        }
    }

    //Ran by the peer who initiated the connection - this completes the handshake (negotiation)
    public async onAnswerWebRTC(serializedAnswer: string) {
        try {
            const adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    this.mainRpcService.senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("onAnswerWebRTC - no EVM address");
            const connection = this.connectionMap.get(adr.toString());
            if (!connection)
                return console.log("onAnswerWebRTC - no connection");
            const answer = JSON.parse(serializedAnswer);
            console.log("onAnswerWebRTC - answer", answer);
            await connection.setRemoteDescription(answer);
        } catch (e) {
            console.log("onAnswerWebRTC - error", e);
        }
    }

    // Handle ICE candidates
    public async onIceCandidate(serializedCandidate: string) {
        try {
            const candidate = new RTCIceCandidate(
                JSON.parse(serializedCandidate)
            );
            const adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    this.mainRpcService.senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("onIceCandidate - no EVM address");

            const connection = this.connectionMap.get(adr.toString());
            if (!connection)
                return console.log("onIceCandidate - no connection");

            await connection.addIceCandidate(candidate);
        } catch (error) {
            console.error("onIceCandidate - error:", error);
        }
    }
}

export default WebRTCSetupService;
