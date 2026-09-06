import StateTransitionRpcMethods from "./StateTransitionRpcMethods";
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { ATransport } from "@/transport";

class StateTransitionService extends ARpcService<StateTransitionRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "StateTransitionService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }
    public createRPCMethods(transport: ATransport): StateTransitionRpcMethods {
        return new StateTransitionRpcMethods(transport, this);
    }
}

export default StateTransitionService;
