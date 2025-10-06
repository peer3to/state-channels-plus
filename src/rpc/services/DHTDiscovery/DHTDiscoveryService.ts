import { ARpcService } from "@/rpc";
import P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";
import DHTDiscoveryRpcMethods from "./DHTDiscoveryRpcMethods";

class DHTDiscoveryService extends ARpcService<DHTDiscoveryRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(p2pManager);
    }
    public createRPCMethods(transport: ATransport): DHTDiscoveryRpcMethods {
        return new DHTDiscoveryRpcMethods(transport, this);
    }
}

export default DHTDiscoveryService;
