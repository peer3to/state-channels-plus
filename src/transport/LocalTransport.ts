import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import WebSocket from "ws";
import { TransportType } from "./TransportType";
class LocalTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH; // not holepunch, but probably doesn't matter for testing
    ws: WebSocket;
    constructor(ws: WebSocket, p2pManager: P2PManager) {
        super(p2pManager);
        this.ws = ws;
        this.ws.on("message", async (data: any) => {
            this.onMessage(data);
        });

        // Ensure we clean up our transport when the underlying socket closes.
        this.ws.on("close", () => {
            this.close();
        });

        // Treat socket errors as a connection close for transport lifecycle.
        this.ws.on("error", () => {
            this.close();
        });
    }
    send(serializedRPC: string): void {
        this.ws.send(serializedRPC);
    }
    onMessage(data: any): void {
        const serializedRPC = data.toString();
        this.p2pManager.onRpc(serializedRPC, this);
    }
    _close(): void {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.close();
        }
    }
}
export default LocalTransport;
