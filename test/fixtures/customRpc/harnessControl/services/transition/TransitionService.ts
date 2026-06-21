import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import TransitionRpcMethods from "./TransitionRpcMethods";

/**
 * State-transition operations the harness drives on a peer (snapshot posting,
 * snapshot-update preparation, block-confirmation ingestion). Accessors live
 * here (not on RpcMethods) since every RpcMethods method is routable by name at
 * runtime.
 */
export class TransitionService extends ARpcService<TransitionRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessTransitionService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: ATransport): TransitionRpcMethods {
        return new TransitionRpcMethods(transport, this);
    }
}

export default TransitionService;
