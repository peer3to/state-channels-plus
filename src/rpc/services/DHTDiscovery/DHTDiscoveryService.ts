import { ARpcService } from "@/rpc";
import type P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";
import DHTDiscoveryRpcMethods from "./DHTDiscoveryRpcMethods";
import { HandshakeCompletedGuard } from "@/rpc/guards";

class DHTDiscoveryService extends ARpcService<DHTDiscoveryRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "DHTDiscoveryService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }
    public createRPCMethods(transport: ATransport): DHTDiscoveryRpcMethods {
        return new DHTDiscoveryRpcMethods(transport, this);
    }
}

export default DHTDiscoveryService;
