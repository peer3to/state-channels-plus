import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory";

class WebRTCTransport extends ATransport {
    transportType = TransportType.WEBRTC;
    webRTCChannel: WebRTCDataChannelLike;

    constructor(webRTCChannel: WebRTCDataChannelLike, p2pManager: P2PManager) {
        super(p2pManager);
        this.webRTCChannel = webRTCChannel;

        if (
            this.webRTCChannel.readyState !== undefined &&
            this.webRTCChannel.readyState !== "open"
        ) {
            throw new Error("WebRTCTransport requires an open RTCDataChannel");
        }

        this.webRTCChannel.onmessage = (event: any) => {
            this.onMessage(event.data);
        };
        this.webRTCChannel.onclose = () => {
            this.close();
        };
        this.webRTCChannel.onerror = (error: Error) => {
            const connectionState = this.getConnectionState();
            this.p2pManager.logger.debug("WebRTC channel error", {
                connectionState,
                error
            });
            this.close();
        };

        this.p2pManager.logger.debug("WebRTC channel opened");
        this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
        //TODO! update peerProfile and close old socket
    }

    private getConnectionState(): {
        connectionState: string;
        iceState: string;
    } {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(this);
        const peerAddress =
            this.peerAddress ||
            profile?.getEvmAddress()?.toString() ||
            "unknown";

        let connectionState = "unknown";
        let iceState = "unknown";
        try {
            const webRTCSetupService =
                this.p2pManager.localRpc?.webRTCSetupService;
            if (webRTCSetupService?.getWebRTCConnectionState) {
                const state =
                    webRTCSetupService.getWebRTCConnectionState(peerAddress);
                connectionState = state.connectionState;
                iceState = state.iceState;
            }
        } catch {
            // Ignore errors accessing connection state
        }
        return { connectionState, iceState };
    }
    _send(serializedRPC: string): void {
        this.p2pManager.logger.debug("Sending RPC over WebRTC", {
            bytes: serializedRPC.length
        });
        this.webRTCChannel.send(serializedRPC);
    }
    onMessage(data: any): void {
        if (data instanceof Uint8Array) data = Buffer.from(data);
        if (data instanceof Buffer) data = data.toString();
        const serializedRPC = data;
        this.p2pManager.logger.debug("Received RPC over WebRTC", {
            bytes: serializedRPC.length
        });
        this.p2pManager.onRpc(serializedRPC, this);
    }
    _close(): void {
        this.p2pManager.logger.debug("Closing WebRTC channel");
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(this);
        const peerAddress =
            this.peerAddress || profile?.getEvmAddress()?.toString();
        if (peerAddress) {
            this.p2pManager.localRpc?.webRTCSetupService?.closeWebRTCConnection(
                peerAddress
            );
        }
        this.webRTCChannel.close();
    }
}
export default WebRTCTransport;
