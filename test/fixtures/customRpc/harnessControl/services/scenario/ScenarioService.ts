import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import ScenarioRpcMethods from "./ScenarioRpcMethods";

/**
 * Runs harness-supplied `(sm, args) => result` bodies host-side, with the live
 * stateManager injected. The escape hatch for white-box scenarios that need to
 * drive in-process internals (mutex, validationService, onBlockConfirmation,
 * local RPC services) which can't be reached across the runtime port. Bodies are
 * shipped as source and rebuilt via `new Function`, so they're closure-free:
 * reach everything through `sm`, pass captured values via `args`, and return
 * only serializable data.
 */
export class ScenarioService extends ARpcService<ScenarioRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessScenarioService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: ATransport): ScenarioRpcMethods {
        return new ScenarioRpcMethods(transport, this);
    }
}

export default ScenarioService;
