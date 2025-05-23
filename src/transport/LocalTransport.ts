import P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import WebSocket from "ws";
import { TransportType } from "./TransportType";
class LocalTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH; // not holepunch, but probably doesn't matter for testing
    ws: WebSocket;
    p2pManager: P2PManager;
    constructor(ws: WebSocket, p2pManager: P2PManager) {
        super();
        this.p2pManager = p2pManager;
        this.ws = ws;
        this.ws.on("message", async (data: any) => {
            this.onMessage(data);
        });
    }
    send(serializedRPC: string): void {
        this.ws.send(serializedRPC);
    }
    onMessage(data: any): void {
        this.p2pManager.localRpcService.senderTransport = this;
        let serializedRPC = data.toString();
        this.p2pManager.onRpc(serializedRPC);
    }
    _close(): void {
        throw new Error("Method not implemented."); //TODO!S
    }
}
export default LocalTransport;
