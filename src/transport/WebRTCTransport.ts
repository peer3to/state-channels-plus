import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
class WebRTCTransport extends ATransport {
    transportType = TransportType.WEBRTC;
    webRTCChannel: any;
    constructor(webRTCChannel: any, p2pManager: P2PManager) {
        super(p2pManager);
        this.webRTCChannel = webRTCChannel;
        this.webRTCChannel.onmessage = (event: any) => {
            this.onMessage(event.data);
        };
        this.webRTCChannel.onopen = () => {
            console.log("WebRTC Channel Opened");
            this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
            //TODO! update peerProfile and close old socket
        };
        this.webRTCChannel.onclose = () => {
            console.log("WebRTC Channel Closed");
            this.close();
        };
    }
    send(serializedRPC: string): void {
        console.log("WebRTC - SendingRPC", serializedRPC);
        this.webRTCChannel.send(serializedRPC);
    }
    onMessage(data: any): void {
        if (data instanceof Uint8Array) data = Buffer.from(data);
        if (data instanceof Buffer) data = data.toString();
        const serializedRPC = data;
        console.log("WebRTC - onMessage", serializedRPC);
        this.p2pManager.onRpc(serializedRPC, this);
    }
    _close(): void {
        console.log("closing webRTC channel");
        this.webRTCChannel.close();
    }
}
export default WebRTCTransport;
