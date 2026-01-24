import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import WebSocket from "ws";
import { TransportType } from "./TransportType";
import { LoggerUtils } from "@/utils/LoggerUtils";

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
        this.ws.on("close", (code: number, reason: Buffer) => {
            const closeReason = reason?.toString() || `code: ${code}`;
            LoggerUtils.logTransportDisconnect(this, {
                reason: `WebSocket connection closed: ${closeReason}`,
                initiator: "unknown",
                connectionState: "closed",
                socketState: this.ws?.readyState,
                logLevel: "info"
            });
            this.close();
        });

        // Treat socket errors as a connection close for transport lifecycle.
        this.ws.on("error", (error: Error) => {
            LoggerUtils.logTransportDisconnect(this, {
                reason: "WebSocket connection failed due to error",
                initiator: "unknown",
                connectionState: "error",
                socketState: this.ws?.readyState,
                error,
                logLevel: "info"
            });
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
