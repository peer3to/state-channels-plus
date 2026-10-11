import StateTransitionRpcMethods from "./StateTransitionRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import {
    HandshakeCompletedGuard,
    WaitForSyncStatusGuard
} from "@/rpc/network/guards";
import { NetworkTransport } from "@/transport";

class StateTransitionService extends ANetworkRpcService<StateTransitionRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "StateTransitionService"
            })
        );
        // live blocks wait for the initial sync (see WaitForSyncStatusGuard)
        this.guards = [
            new HandshakeCompletedGuard(this),
            new WaitForSyncStatusGuard(this)
        ];
    }
    public createRPCMethods(
        transport: NetworkTransport
    ): StateTransitionRpcMethods {
        return new StateTransitionRpcMethods(transport, this);
    }
}

export default StateTransitionService;
