import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import BalanceRpcMethods from "./BalanceRpcMethods";

/**
 * Balance math the harness drives on a peer's host-side diamond state machine
 * (withdrawal deltas, subtraction, equality). Accessors live here (not on
 * RpcMethods) since every RpcMethods method is routable by name at runtime.
 */
export class BalanceService extends ARpcService<BalanceRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessBalanceService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: ATransport): BalanceRpcMethods {
        return new BalanceRpcMethods(transport, this);
    }
}

export default BalanceService;
