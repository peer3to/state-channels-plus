import { ARpcService, MainRpcService } from "@/rpc";
//@ts-ignore
import { RTCPeerConnection } from "get-webrtc";
import WebRTCTransport from "@/transport/WebRTCTransport";
import P2PManager from "@/P2PManager";
import WebRTCSetupRpcMethods from "./WebRTCSetupRpcMethods";
import { ATransport } from "@/transport";

class WebRTCSetupService extends ARpcService<WebRTCSetupRpcMethods> {
    connectionMap: Map<string, RTCPeerConnection> = new Map();

    constructor(p2pManager: P2PManager) {
        super(p2pManager);
    }

    public createRPCMethods(transport: ATransport): WebRTCSetupRpcMethods {
        return new WebRTCSetupRpcMethods(transport, this);
    }

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC(transport: ATransport) {
        //TODO! - require seccusfull init handshake (also on other methods)
        try {
            console.log("initiateWebRTC");
            const connection = new RTCPeerConnection();
            const channel = connection.createDataChannel("webRTC-DataChannel");
            const webRTCTransport = new WebRTCTransport(
                channel,
                this.p2pManager
            );

            // Handle ICE candidates
            connection.onicecandidate = async (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    const rpcHandler =
                        await this.remoteRpc.webRTCSetupService.onIceCandidate(
                            serializedCandidate
                        );
                    rpcHandler.sendOne(transport);
                }
            };

            const offer = await connection.createOffer();
            connection.setLocalDescription(offer);
            const adr =
                this.p2pManager.profileManager.getProfileByTransport(
                    transport
                )?.evmAddress;
            if (!adr) return console.log("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            const serializedOffer = JSON.stringify(offer);
            const rpcHandler =
                await this.remoteRpc.webRTCSetupService.onOfferWebRTC(
                    serializedOffer
                );
            rpcHandler.sendOne(transport);
        } catch (e) {
            console.log("initiateWebRTC - error", e);
        }
    }
}

export default WebRTCSetupService;
