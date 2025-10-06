import P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";

abstract class ARpcMethods {
    senderTransport: ATransport;
    p2pManager: P2PManager;
    constructor(transport: ATransport, p2pManager: P2PManager) {
        this.senderTransport = transport;
        this.p2pManager = p2pManager;
    }

    get remoteRpc() {
        return this.p2pManager.remoteRpc;
    }
}

export default ARpcMethods;
