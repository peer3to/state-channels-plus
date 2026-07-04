import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { TransportType } from "./TransportType";

/**
 * Base transport over a native browser `WebSocket`, used for local peer
 * discovery in browser test/dev via a relay hub (see the browser
 * `LocalDiscoveryServer`). Mirrors the node {@link LocalTransport} but for the
 * native `WebSocket` API instead of the `ws` package. It carries the handshake
 * and WebRTC signaling frames until the connection upgrades to WebRTC.
 */
class BrowserLocalTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH;
    private readonly ws: WebSocket;

    constructor(ws: WebSocket, p2pManager: P2PManager) {
        super(p2pManager);
        this.ws = ws;
        this.ws.onmessage = (event: MessageEvent) => this.onMessage(event.data);
        this.ws.onclose = () => this.close();
        this.ws.onerror = () => this.close();
    }

    _send(serializedRPC: string): void {
        this.ws.send(serializedRPC);
    }

    onMessage(data: unknown): void {
        this.p2pManager.onRpc(String(data), this);
    }

    _close(): void {
        if (this.ws.readyState === this.ws.OPEN) {
            this.ws.close();
        }
    }
}

export default BrowserLocalTransport;
