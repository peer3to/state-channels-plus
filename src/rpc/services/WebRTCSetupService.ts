import { AddressLike, BytesLike } from "ethers";
import ARpcService from "../ARpcService";
import MainRpcService from "../MainRpcService";
//@ts-ignore
import { RTCPeerConnection } from "get-webrtc";
import WebRTCTransport from "../../transport/WebRTCTransport";

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
            let connection = new RTCPeerConnection();
            let channel = connection.createDataChannel("webRTC-DataChannel");
            let webRTCTransport = new WebRTCTransport(
                channel,
                this.mainRpcService.p2pManager
            );

            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    let serializedCandidate = JSON.stringify(event.candidate);
                    this.mainRpcService.rpcProxy
                        .onIceCandidate(serializedCandidate)
                        .sendOne(this.mainRpcService.senderTransport!);
                }
            };

            let senderTransport = this.mainRpcService.senderTransport; // catch it here since async call below
            let offer = await connection.createOffer();
            connection.setLocalDescription(offer);
            let adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            let serializedOffer = JSON.stringify(offer);
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
            let connection = new RTCPeerConnection();
            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    let serializedCandidate = JSON.stringify(event.candidate);
                    this.mainRpcService.rpcProxy
                        .onIceCandidate(serializedCandidate)
                        .sendOne(this.mainRpcService.senderTransport!);
                }
            };
            connection.ondatachannel = (event: any) => {
                console.log("WebRTC - onOfferWebRTC - ondatachannel");
                let webRTCTransport = new WebRTCTransport(
                    event.channel,
                    this.mainRpcService.p2pManager
                );
            };
            let senderTransport = this.mainRpcService.senderTransport; // catch it here since async call below
            let adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            let offer = JSON.parse(serializedOffer);
            console.log("onOfferWebRTC - offer", offer);
            await connection.setRemoteDescription(offer);
            let answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            let serializedAnswer = JSON.stringify(answer);
            this.mainRpcService.rpcProxy
                .onAnswerWebRTC(serializedAnswer)
                .sendOne(senderTransport!);
        } catch (e) {
            console.log("onOfferWebRTC - error", e);
        }
    }

    //Ran by the peer who initiated the connection - this completes the handshake (negoation)
    public async onAnswerWebRTC(serializedAnswer: string) {
        try {
            let adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    this.mainRpcService.senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("onAnswerWebRTC - no EVM address");
            let connection = this.connectionMap.get(adr.toString());
            if (!connection)
                return console.log("onAnswerWebRTC - no connection");
            let answer = JSON.parse(serializedAnswer);
            console.log("onAnswerWebRTC - answer", answer);
            await connection.setRemoteDescription(answer);
        } catch (e) {
            console.log("onAnswerWebRTC - error", e);
        }
    }

    // Handle ICE candidates
    public async onIceCandidate(serializedCandidate: string) {
        try {
            let candidate = new RTCIceCandidate(
                JSON.parse(serializedCandidate)
            );
            let adr =
                this.mainRpcService.p2pManager.profileManager.getProfileByTransport(
                    this.mainRpcService.senderTransport!
                )?.evmAddress;
            if (!adr) return console.log("onIceCandidate - no EVM address");

            let connection = this.connectionMap.get(adr.toString());
            if (!connection)
                return console.log("onIceCandidate - no connection");

            await connection.addIceCandidate(candidate);
        } catch (error) {
            console.error("onIceCandidate - error:", error);
        }
    }
}

export default WebRTCSetupService;
