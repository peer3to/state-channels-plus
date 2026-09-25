import type { ChecksumAddress, FunctionSelector } from "@/types/types";

/** One finished receipt handed to {@link GasUsageTable.record}. */
export interface GasUsageEntry {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    gasUsed: bigint;
    reverted: boolean;
}

/**
 * One aggregated (contract, function) row of a gas usage snapshot. Every field
 * describes either the successful transactions or the reverted ones; the two
 * are never mixed, so `minGasUsed` stays the cheapest real cost of the call
 * and not the cost of its cheapest failure.
 */
export interface GasUsageRow {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    /** Mined transactions that did not revert. */
    successCount: number;
    /** Decimal strings: a raw bigint must never reach `JSON.stringify`. */
    successGasUsed: string;
    /** Bounds over the successful transactions only; `"0"` while there are none. */
    minGasUsed: string;
    maxGasUsed: string;
    /** Mined transactions that came back with receipt status 0. */
    revertedCount: number;
    /** What those reverted transactions burned. */
    revertedGasUsed: string;
}

/** Running totals behind one snapshot row. */
interface GasUsageAggregate {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    successCount: number;
    successGasUsed: bigint;
    minGasUsed: bigint;
    maxGasUsed: bigint;
    revertedCount: number;
    revertedGasUsed: bigint;
}

/** Identifies one aggregate: the called contract plus the selector on it. */
type GasUsageKey = string;

/** Code-unit order, so a snapshot never depends on the host locale. */
function compareText(left: string, right: string): number {
    if (left < right) return -1;
    return left > right ? 1 : 0;
}

/**
 * Gas of the contract calls one peer sent, aggregated per (contract,
 * function). Pure: it takes finished receipts and answers snapshots, and owns
 * no timers, no I/O and no chain access.
 *
 * A reverted transaction burned real gas, so it carries its own count and its
 * own total in the same row. It stays out of the success count, the success
 * total and the bounds, because a revert costs a fraction of the call and
 * would otherwise answer "how much does this function cost" with the price of
 * its cheapest failure.
 */
class GasUsageTable {
    private readonly aggregates = new Map<GasUsageKey, GasUsageAggregate>();

    public record(entry: GasUsageEntry): void {
        const key = `${entry.contractAddress}:${entry.functionSelector}`;
        let aggregate = this.aggregates.get(key);
        if (!aggregate) {
            aggregate = {
                contractAddress: entry.contractAddress,
                functionSelector: entry.functionSelector,
                functionName: entry.functionName,
                successCount: 0,
                successGasUsed: 0n,
                minGasUsed: 0n,
                maxGasUsed: 0n,
                revertedCount: 0,
                revertedGasUsed: 0n
            };
            this.aggregates.set(key, aggregate);
        }
        if (entry.reverted) {
            aggregate.revertedCount += 1;
            aggregate.revertedGasUsed += entry.gasUsed;
            return;
        }
        // The first success seeds both bounds; a zeroed bound would otherwise
        // stay the minimum forever.
        if (aggregate.successCount === 0) {
            aggregate.minGasUsed = entry.gasUsed;
            aggregate.maxGasUsed = entry.gasUsed;
        }
        if (entry.gasUsed < aggregate.minGasUsed)
            aggregate.minGasUsed = entry.gasUsed;
        if (entry.gasUsed > aggregate.maxGasUsed)
            aggregate.maxGasUsed = entry.gasUsed;
        aggregate.successCount += 1;
        aggregate.successGasUsed += entry.gasUsed;
    }

    /** Rows ordered by contract address, then function name, then selector. */
    public snapshot(): GasUsageRow[] {
        return [...this.aggregates.values()]
            .map((aggregate) => ({
                contractAddress: aggregate.contractAddress,
                functionSelector: aggregate.functionSelector,
                functionName: aggregate.functionName,
                successCount: aggregate.successCount,
                successGasUsed: aggregate.successGasUsed.toString(),
                minGasUsed: aggregate.minGasUsed.toString(),
                maxGasUsed: aggregate.maxGasUsed.toString(),
                revertedCount: aggregate.revertedCount,
                revertedGasUsed: aggregate.revertedGasUsed.toString()
            }))
            .sort(
                (left, right) =>
                    compareText(left.contractAddress, right.contractAddress) ||
                    compareText(left.functionName, right.functionName) ||
                    compareText(left.functionSelector, right.functionSelector)
            );
    }
}

export default GasUsageTable;
