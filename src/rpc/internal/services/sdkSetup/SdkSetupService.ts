import { SdkSetupRpcMethods } from "./SdkSetupRpcMethods";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type Rpc from "@/rpc/Rpc";
import type InternalTransport from "@/transport/InternalTransport";
import type { Logger } from "@/utils";

export class SdkSetupService extends AInternalRpcService<SdkSetupRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        private readonly buildRuntime: (
            localAddress: string,
            diamondAddress: string
        ) => Promise<void>,
        private readonly logger: Logger
    ) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new SdkSetupRpcMethods(this, sender);
    }

    public async deployComplete(
        localAddress: string,
        diamondAddress: string,
        sender: InternalTransport
    ) {
        try {
            await this.buildRuntime(localAddress, diamondAddress);
        } catch (error) {
            try {
                await this.router.rpcRoot.lifecycle.disposeFromParent(sender);
            } catch (cleanupError) {
                this.logger.error("Runtime readiness cleanup failed", {
                    cleanupError
                });
            }
            throw error;
        }
    }

    // Overrides AInternalRpcService.afterResponse so failed setup replies before closing its parent port.
    protected override afterResponse(
        _rpc: Rpc,
        sender: InternalTransport
    ): void {
        this.router.rpcRoot.lifecycle.disposalResponseAttempted(sender);
    }
}
