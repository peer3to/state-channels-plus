// @spec-test-coverage-ignore: test-only service for observing handler-entry mutex state
import type { ReadyLifecycleRpc } from "../ReadyLifecycleRpcManifest";
import { MutexProbeRpcMethods } from "./MutexProbeRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

export class MutexProbeService extends ANetworkRpcService<
    MutexProbeRpcMethods,
    P2PManager<ReadyLifecycleRpc>
> {
    constructor(p2pManager: P2PManager<ReadyLifecycleRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "MutexProbeService"
            })
        );
    }

    public createRPCMethods(transport: NetworkTransport): MutexProbeRpcMethods {
        return new MutexProbeRpcMethods(transport, this);
    }
}
