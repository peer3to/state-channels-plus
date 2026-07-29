import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory";

class WebRTCTransport extends ATransport {
    transportType = TransportType.WEBRTC;
    webRTCChannel: WebRTCDataChannelLike;
    private hasStartedHandshake = false;
    private pendingOutboundRpcs: string[] = [];

    constructor(webRTCChannel: WebRTCDataChannelLike, p2pManager: P2PManager) {
        super(p2pManager);
        this.webRTCChannel = webRTCChannel;

        this.webRTCChannel.onmessage = (event: any) => {
            this.onMessage(event.data);
        };
        this.webRTCChannel.onopen = () => {
            this.onChannelOpen();
        };
        this.webRTCChannel.onclose = () => {
            this.pendingOutboundRpcs = [];
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

        this.p2pManager.logger.debug("WebRTC channel created", {
            readyState: this.webRTCChannel.readyState
        });

        if (this.webRTCChannel.readyState === "open") {
            this.onChannelOpen();
        }
    }

    private onChannelOpen(): void {
        this.p2pManager.logger.debug("WebRTC channel opened");
        this.flushPendingOutboundRpcs();
        this.startHandshake();
    }

    private startHandshake(): void {
        if (this.hasStartedHandshake) return;
        this.hasStartedHandshake = true;
        this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
    }

    private flushPendingOutboundRpcs(): void {
        if (
            this.webRTCChannel.readyState !== "open" ||
            this.pendingOutboundRpcs.length === 0
        ) {
            return;
        }

        const pendingRpcs = this.pendingOutboundRpcs;
        this.pendingOutboundRpcs = [];
        this.p2pManager.logger.debug("Flushing queued WebRTC RPCs", {
            count: pendingRpcs.length,
            bytes: pendingRpcs.reduce((sum, rpc) => sum + rpc.length, 0)
        });
        pendingRpcs.forEach((serializedRPC) => {
            this.sendNow(serializedRPC);
        });
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
    private sendNow(serializedRPC: string): void {
        this.p2pManager.logger.debug("Sending RPC over WebRTC", {
            bytes: serializedRPC.length,
            readyState: this.webRTCChannel.readyState
        });
        this.webRTCChannel.send(serializedRPC);
    }

    _send(serializedRPC: string): void {
        const readyState = this.webRTCChannel.readyState || "unknown";
        if (readyState === "open") {
            this.sendNow(serializedRPC);
            return;
        }

        if (readyState === "closed" || readyState === "closing") {
            this.p2pManager.logger.warn(
                "Dropping RPC because WebRTC channel is not sendable",
                {
                    bytes: serializedRPC.length,
                    readyState
                }
            );
            return;
        }

        this.pendingOutboundRpcs.push(serializedRPC);
        this.p2pManager.logger.debug("Queued RPC until WebRTC channel opens", {
            bytes: serializedRPC.length,
            readyState,
            queuedCount: this.pendingOutboundRpcs.length
        });
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
