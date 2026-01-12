import { ATransport } from "@/transport";
import type P2PManager from "@/P2PManager";

abstract class ARpcMethods<TP2PManager extends P2PManager = P2PManager> {
    senderTransport: ATransport;
    p2pManager: TP2PManager;
    constructor(transport: ATransport, p2pManager: TP2PManager) {
        this.senderTransport = transport;
        this.p2pManager = p2pManager;
    }

    get remoteRpc(): TP2PManager["remoteRpc"] {
        return this.p2pManager.remoteRpc;
    }
}

export default ARpcMethods;
