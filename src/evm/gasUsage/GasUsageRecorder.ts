import GasUsageTable, { type GasUsageRow } from "./GasUsageTable";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import { settleBy } from "@/utils/settleBy";
import {
    ethers,
    type TransactionReceipt,
    type TransactionResponse
} from "ethers";

/** Feeds mined receipts into the table on a wait of its own; never rejects. */
class GasUsageRecorder {
    private readonly table = new GasUsageTable();
    /** Receipt waits still running. Each one settles and never rejects. */
    private readonly inFlight = new Set<Promise<void>>();
    private readonly logger?: Logger;

    constructor(logger?: Logger) {
        this.logger = logger;
    }

    /** Count `response` once it mines. Returns at once; never throws. */
    public observe(response: TransactionResponse): void {
        const observation = this.recordWhenMined(response).catch((error) => {
            this.logger?.debug("Gas usage observation failed", {
                hash: response.hash,
                error: errorMessage(error)
            });
        });
        this.inFlight.add(observation);
        void observation.finally(() => this.inFlight.delete(observation));
    }

    /**
     * Resolves once every observation started before this call has settled.
     * `timeoutMs` stops waiting for the ones still running, for a caller that
     * may not wait on the chain. They keep running, and each one is counted
     * once it mines.
     */
    public async settle(timeoutMs?: number): Promise<void> {
        const pending = [...this.inFlight];
        if (pending.length === 0) return;
        const settled = Promise.all(pending).then(() => undefined);
        if (timeoutMs === undefined) {
            await settled;
            return;
        }
        await settleBy(settled, Date.now() + timeoutMs);
    }

    /** The unsettled rows; a reader wanting freshness uses `settledSnapshot`. */
    public snapshot(): GasUsageRow[] {
        return this.table.snapshot();
    }

    /**
     * The read every reporter uses: the rows once the observations already
     * started have settled, so a caller that awaited its own `wait()` never
     * reads a table that is one microtask short of its own transaction. With
     * `timeoutMs`, a receipt still pending when the bound expires is not in
     * this read; it shows up on a later read once it mines.
     */
    public async settledSnapshot(timeoutMs?: number): Promise<GasUsageRow[]> {
        await this.settle(timeoutMs);
        return this.table.snapshot();
    }

    private async recordWhenMined(
        response: TransactionResponse
    ): Promise<void> {
        const contractAddress = response.to;
        // A deployment has no callee, and the table keys on the called contract.
        if (!contractAddress) return;
        const receipt = await this.resolveReceipt(response);
        if (!receipt) return;
        const { functionSelector, functionName } =
            LoggerUtils.getContractCallMetadata(response.data);
        this.table.record({
            contractAddress,
            functionSelector,
            functionName,
            gasUsed: receipt.gasUsed,
            reverted: receipt.status === 0
        });
    }

    private async resolveReceipt(
        response: TransactionResponse
    ): Promise<TransactionReceipt | null> {
        try {
            // No timeout: a transaction counts whenever it mines, for as long
            // as this recorder lives. An ethers timeout arms a global timer
            // that destroying the provider never clears; a wait whose provider
            // closed never settles and goes with the runtime.
            return await response.wait(1);
        } catch (error) {
            // A reverted transaction still mined and still burned its gas;
            // ethers reports it as a CALL_EXCEPTION carrying the receipt.
            if (ethers.isError(error, "CALL_EXCEPTION"))
                return error.receipt ?? null;
            // Replaced or dropped: no receipt means nothing mined, so nothing
            // is counted.
            this.logger?.debug("Transaction left out of the gas usage table", {
                hash: response.hash,
                error: errorMessage(error)
            });
            return null;
        }
    }
}

export default GasUsageRecorder;
