// @spec-test-coverage-ignore: test-only service for observing handler-entry mutex state
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type ATransport from "@/transport/ATransport";
import type { ReadyLifecycleRpc } from "../ReadyLifecycleRpcManifest";
import { MutexProbeRpcMethods } from "./MutexProbeRpcMethods";

export class MutexProbeService extends ARpcService<
    MutexProbeRpcMethods,
    P2PManager<ReadyLifecycleRpc>
> {
    constructor(p2pManager: P2PManager<ReadyLifecycleRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "MutexProbeService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): MutexProbeRpcMethods {
        return new MutexProbeRpcMethods(transport, this);
    }
}
