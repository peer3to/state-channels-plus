import GasUsageTable, { type GasUsageRow } from "./GasUsageTable";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    ethers,
    type TransactionReceipt,
    type TransactionResponse
} from "ethers";

/**
 * Feeds real receipts into a {@link GasUsageTable}. The observation runs
 * beside the caller on a wait of its own, so the response the caller got back
 * keeps its own `wait()` semantics and the nonce owner keeps its bookkeeping.
 * Only mined transactions are counted; a dropped or replaced one is not.
 */
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

    /** Resolves once every observation started so far has settled. */
    public async settle(): Promise<void> {
        while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
    }

    public snapshot(): GasUsageRow[] {
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
            return await response.wait();
        } catch (error) {
            // A reverted transaction still mined and still burned its gas;
            // ethers reports it as a CALL_EXCEPTION carrying the receipt.
            if (ethers.isError(error, "CALL_EXCEPTION"))
                return error.receipt ?? null;
            // Replaced, dropped, or the provider closed under the wait: no
            // receipt means nothing mined, so nothing is counted.
            this.logger?.debug("Transaction left out of the gas usage table", {
                hash: response.hash,
                error: errorMessage(error)
            });
            return null;
        }
    }
}

export default GasUsageRecorder;
