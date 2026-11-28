import { ChainSignerRpcMethods } from "./ChainSignerRpcMethods";
import Clock from "@/Clock";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import { config } from "@/utils/config";

/**
 * How long a gas-usage read answering a request waits for outstanding
 * receipts: `GAS_USAGE_SETTLE_BLOCKS` at the measured block time, and at most
 * half the request timeout so the answer still arrives in time.
 */
export function gasUsageReadSettleMs(requestTimeoutMs: number | null): number {
    const span = Clock.getBlockSpanMs(config.GAS_USAGE_SETTLE_BLOCKS);
    return requestTimeoutMs === null
        ? span
        : Math.min(span, requestTimeoutMs / 2);
}

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
                gasUsageReadSettleMs(this.router.defaultRequestTimeoutMs)
            )
        };
    }

    public createRPCMethods(sender: InternalTransport) {
        return new ChainSignerRpcMethods(this, sender);
    }
}
