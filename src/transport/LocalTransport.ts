import NetworkTransport from "./NetworkTransport";
import { TransportType } from "./TransportType";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import WebSocket from "ws";

class LocalTransport extends NetworkTransport {
    transportType = TransportType.HOLEPUNCH; // not holepunch, but probably doesn't matter for testing
    ws: WebSocket;
    constructor(ws: WebSocket, router: NetworkRpcRouter) {
        super(router);
        this.ws = ws;
        this.ws.on("message", async (data: any) => {
            this.onMessage(data);
        });

        // Ensure we clean up our transport when the underlying socket closes.
        this.ws.on("close", (code: number, reason: Buffer) => {
            this.close();
        });

        // Treat socket errors as a connection close for transport lifecycle.
        this.ws.on("error", (error: Error) => {
            this.p2pManager.logger.error("LocalTransport WebSocket error", {
                socketState: this.ws?.readyState,
                error
            });
            this.close();
        });
    }
    _send(serializedRPC: string): void {
        this.ws.send(serializedRPC);
    }
    _close(): void {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.close();
        }
    }
}
export default LocalTransport;
