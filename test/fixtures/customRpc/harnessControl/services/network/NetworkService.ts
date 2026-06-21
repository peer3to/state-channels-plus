import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import NetworkRpcMethods from "./NetworkRpcMethods";

/** Connection / network control operations exposed to the test harness. */
export class NetworkService extends ARpcService<NetworkRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessNetworkService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): NetworkRpcMethods {
        return new NetworkRpcMethods(transport, this);
    }
}

export default NetworkService;
