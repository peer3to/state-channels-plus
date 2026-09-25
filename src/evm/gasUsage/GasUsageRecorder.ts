import GasUsageTable, { type GasUsageRow } from "./GasUsageTable";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
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
    /** Resolves with no receipt once `dispose()` ends the waits still running. */
    private readonly disposal: Promise<null>;
    private endReceiptWaits!: () => void;
    private disposed = false;

    constructor(logger?: Logger) {
        this.logger = logger;
        this.disposal = new Promise<null>((resolve) => {
            this.endReceiptWaits = () => resolve(null);
        });
    }

    /** Count `response` once it mines. Returns at once; never throws. */
    public observe(response: TransactionResponse): void {
        // A disposed recorder starts no new wait on a chain that is going away.
        if (this.disposed) return;
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
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                settled,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, timeoutMs);
                })
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
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

    /**
     * Ends every receipt wait still running as not counted, so any `settle()`
     * resolves at once, and makes every later `observe()` a no-op. The owner
     * calls it when its chain connection goes away: a receipt wait has no
     * bound of its own, and a destroyed provider never ends it.
     */
    public dispose(): void {
        this.disposed = true;
        this.endReceiptWaits();
    }

    private async recordWhenMined(
        response: TransactionResponse
    ): Promise<void> {
        const contractAddress = response.to;
        // A deployment has no callee, and the table keys on the called contract.
        if (!contractAddress) return;
        const receipt = await Promise.race([
            this.resolveReceipt(response),
            this.disposal
        ]);
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
            // that destroying the provider never clears, and ethers never
            // rejects a wait whose provider closed, so `dispose()` ends it.
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
