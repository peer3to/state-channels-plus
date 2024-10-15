import P2PManager from "../P2PManager";
import ATransport from "../transport/ATransport";
import Rpc, { serializeRpc } from "./Rpc";

class RpcHandler {
    rpc: Rpc;
    p2pManager: P2PManager;
    constructor(rpc: Rpc, p2pManager: P2PManager) {
        this.rpc = rpc;
        this.p2pManager = p2pManager;
    }

    public broadcast() {
        this.p2pManager.broadcastRpc(serializeRpc(this.rpc));
    }
    public sendOne(transport: ATransport) {
        transport.send(serializeRpc(this.rpc));
    }
    public sendMultiple(transports: ATransport[]) {
        transports.forEach((transport) => {
            transport.send(serializeRpc(this.rpc));
        });
    }
}

export default RpcHandler;
