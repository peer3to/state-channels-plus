import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { ARpcService, MainRpcService } from "@/rpc";
import type P2PManager from "@/P2PManager";
import StateTransitionRpcMethods from "./StateTransitionRpcMethods";
import { ATransport } from "@/transport";
import { HandshakeCompletedGuard } from "@/rpc/guards";

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
