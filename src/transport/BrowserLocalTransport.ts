import NetworkTransport from "./NetworkTransport";
import { TransportType } from "./TransportType";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";

/**
 * Base transport over a native browser `WebSocket`, used for local peer
 * discovery in browser test/dev via a relay hub (see the browser
 * `LocalDiscoveryServer`). Mirrors the node {@link LocalTransport} but for the
 * native `WebSocket` API instead of the `ws` package. It carries the handshake
 * and WebRTC signaling frames until the connection upgrades to WebRTC.
 */
class BrowserLocalTransport extends NetworkTransport {
    transportType = TransportType.HOLEPUNCH;
    private readonly ws: WebSocket;

    constructor(ws: WebSocket, router: NetworkRpcRouter) {
        super(router);
        this.ws = ws;
        this.ws.onmessage = (event: MessageEvent) => this.onMessage(event.data);
        this.ws.onclose = () => this.close();
        this.ws.onerror = () => this.close();
    }

    // Overrides NetworkTransport.onMessage to pass browser WebSocket frames.
    public override onMessage(data: unknown): void {
        void this.router.onRpc(String(data), this);
    }

    _send(serializedRPC: string): void {
        this.ws.send(serializedRPC);
    }

    _close(): void {
        if (this.ws.readyState === this.ws.OPEN) {
            this.ws.close();
        }
    }
}

export default BrowserLocalTransport;
