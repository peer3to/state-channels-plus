// @spec-test-coverage-ignore: test-only endpoint for observing handler-entry mutex state
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ReadyLifecycleRpc } from "../ReadyLifecycleRpcManifest";
import type { MutexProbeService } from "./MutexProbeService";

export class MutexProbeRpcMethods extends ARpcMethods<
    P2PManager<ReadyLifecycleRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: MutexProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public isLockedAtHandlerEntry(): boolean {
        return (
            this.service.p2pManager.stateManager.mutex as unknown as {
                isLocked: boolean;
            }
        ).isLocked;
    }
}
