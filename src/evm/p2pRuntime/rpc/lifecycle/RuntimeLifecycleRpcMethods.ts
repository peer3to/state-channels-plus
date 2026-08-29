import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { RuntimeLifecycleService } from "./RuntimeLifecycleService";

export class RuntimeLifecycleRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: RuntimeLifecycleService
    ) {
        super(transport, service.router);
    }

    /** both local state machines are deployed: build the runtime graph. the
     *  reply is the host's readiness; a failure before it tears down what was
     *  built and rejects the same promise the client awaits. */
    async deployComplete(
        localStateMachineAddress: string,
        diamondStateMachineAddress: string
    ): Promise<{ webRTCBridge: boolean }> {
        const host = this.service.host;
        try {
            return await host.buildRuntime(
                localStateMachineAddress,
                diamondStateMachineAddress
            );
        } catch (error) {
            try {
                await host.disposeRuntime();
            } catch (cleanupError) {
                host.logger.error("Runtime readiness cleanup failed", {
                    cleanupError
                });
            }
            throw error;
        }
    }

    /**
     * Drain this host realm's detached promises and report the ones that
     * rejected, so the orchestrator can settle and surface host-side async
     * work over the port.
     */
    quiesce(): Promise<SerializedError[]> {
        return this.service.host.quiesce();
    }

    /** end the runtime; the link closes once this reply is out */
    async dispose(): Promise<void> {
        await this.service.host.disposeRuntime();
        this.service.host.closeAfterReply(this.senderTransport);
    }
}

export default RuntimeLifecycleRpcMethods;
