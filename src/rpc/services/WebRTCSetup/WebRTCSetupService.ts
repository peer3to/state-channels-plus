import { ARpcService, MainRpcService } from "@/rpc";
//@ts-ignore
import { RTCPeerConnection } from "get-webrtc";
import WebRTCTransport from "@/transport/WebRTCTransport";
import type P2PManager from "@/P2PManager";
import WebRTCSetupRpcMethods from "./WebRTCSetupRpcMethods";
import { ATransport } from "@/transport";
import { HandshakeCompletedGuard } from "@/rpc/guards";

class WebRTCSetupService extends ARpcService<WebRTCSetupRpcMethods> {
    connectionMap: Map<string, RTCPeerConnection> = new Map();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "WebRTCSetupService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): WebRTCSetupRpcMethods {
        return new WebRTCSetupRpcMethods(transport, this);
    }

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC(transport: ATransport) {
        //TODO! - require seccusfull init handshake (also on other methods)
        try {
            this.logger.debug("initiateWebRTC");
            const connection = new RTCPeerConnection();
            const channel = connection.createDataChannel("webRTC-DataChannel");
            const webRTCTransport = new WebRTCTransport(
                channel,
                this.p2pManager
            );

            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    this.remoteRpc.webRTCSetupService
                        .onIceCandidate(serializedCandidate)
                        .sendOne(transport);
                }
            };

            const offer = await connection.createOffer();
            connection.setLocalDescription(offer);
            const adr =
                this.p2pManager.profileManager.getProfileByTransport(
                    transport
                )?.evmAddress;
            if (!adr)
                return this.logger.debug("initiateWebRTC - no EVM address");
            this.connectionMap.set(adr.toString(), connection);
            const serializedOffer = JSON.stringify(offer);
            this.remoteRpc.webRTCSetupService
                .onOfferWebRTC(serializedOffer)
                .sendOne(transport);
        } catch (e) {
            this.logger.debug("initiateWebRTC - error", e);
        }
    }
}

export default WebRTCSetupService;
