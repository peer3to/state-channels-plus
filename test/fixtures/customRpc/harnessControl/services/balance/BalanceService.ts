// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import BalanceRpcMethods from "./BalanceRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Balance math the harness drives on a peer's host-side diamond state machine
 * (withdrawal deltas, subtraction, equality). Accessors live here (not on
 * RpcMethods) since every RpcMethods method is routable by name at runtime.
 */
export class BalanceService extends ANetworkRpcService<BalanceRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessBalanceService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: NetworkTransport): BalanceRpcMethods {
        return new BalanceRpcMethods(transport, this);
    }
}

export default BalanceService;
