import { ChainSignerRpcMethods } from "./ChainSignerRpcMethods";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import { config } from "@/utils/config";

export class ChainSignerService extends AInternalRpcService<ChainSignerRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly chainSigner: HostNonceManager
    ) {
        super(router);
    }
    /**
     * The peer's gas usage table in the endpoint's named field. The settle is
     * bounded so the read answers well inside its port request timeout.
     */
    public async gasUsageTable() {
        return {
            gasUsage: await this.chainSigner.gasUsage.settledSnapshot(
                config.GAS_USAGE_SETTLE_MS
            )
        };
    }

    public createRPCMethods(sender: InternalTransport) {
        return new ChainSignerRpcMethods(this, sender);
    }
}
