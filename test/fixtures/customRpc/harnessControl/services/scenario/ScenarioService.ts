// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import ScenarioRpcMethods from "./ScenarioRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Runs harness-supplied `(sm, args) => result` bodies host-side, with the live
 * stateManager injected. The escape hatch for white-box scenarios that need to
 * drive in-process internals (mutex, validationService, onBlockConfirmation,
 * local RPC services) which can't be reached across the runtime port. Bodies are
 * shipped as source and rebuilt via `new Function`, so they're closure-free:
 * reach everything through `sm`, pass captured values via `args`, and return
 * only serializable data.
 */
export class ScenarioService extends ANetworkRpcService<ScenarioRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessScenarioService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: NetworkTransport): ScenarioRpcMethods {
        return new ScenarioRpcMethods(transport, this);
    }
}

export default ScenarioService;
