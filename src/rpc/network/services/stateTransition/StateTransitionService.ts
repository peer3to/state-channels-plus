import StateTransitionRpcMethods from "./StateTransitionRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import { NetworkTransport } from "@/transport";

class StateTransitionService extends ANetworkRpcService<StateTransitionRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "StateTransitionService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }
    public createRPCMethods(
        transport: NetworkTransport
    ): StateTransitionRpcMethods {
        return new StateTransitionRpcMethods(transport, this);
    }
}

export default StateTransitionService;
