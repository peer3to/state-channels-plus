// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { MonitorProbeRpcMethods } from "./MonitorProbeRpcMethods";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type Rpc from "@/rpc/Rpc";
import type InternalTransport from "@/transport/InternalTransport";

export type MonitorCounts = {
    started: number;
    stopped: number;
    sourceStopped: number;
};

export class MonitorProbeService extends AInternalRpcService<MonitorProbeRpcMethods> {
    constructor(
        public readonly root: ContractExecutorRoot,
        public readonly snapshot: () => MonitorCounts
    ) {
        super(root.router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new MonitorProbeRpcMethods(this, sender);
    }
    // Overrides AInternalRpcService.afterResponse to close after the disposal snapshot reply.
    protected override afterResponse(
        rpc: Rpc,
        sender: InternalTransport
    ): void {
        if (rpc.method === "disposeAndSnapshot")
            this.root.lifecycle.disposalResponseAttempted(sender);
    }
}
