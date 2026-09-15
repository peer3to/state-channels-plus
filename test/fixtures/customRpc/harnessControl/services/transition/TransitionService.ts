// @spec-test-coverage-ignore: transition fixture support exercised by owning mapped tests
import TransitionRpcMethods from "./TransitionRpcMethods";
import type { StubService } from "../stub/StubService";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * State-transition operations the harness drives on a peer (snapshot posting,
 * snapshot-update preparation, block-confirmation ingestion). Accessors live
 * here (not on RpcMethods) since every RpcMethods method is routable by name at
 * runtime.
 */
export class TransitionService extends ANetworkRpcService<TransitionRpcMethods> {
    /** Control-port ingests run inside its context so network-drop stubs let them through. */
    readonly stub: StubService;

    constructor(p2pManager: P2PManager, stub: StubService) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessTransitionService"
            })
        );
        this.stub = stub;
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: NetworkTransport): TransitionRpcMethods {
        return new TransitionRpcMethods(transport, this);
    }
}

export default TransitionService;
