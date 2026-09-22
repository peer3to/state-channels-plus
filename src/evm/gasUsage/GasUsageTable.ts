import type { ChecksumAddress, FunctionSelector } from "@/types/types";

/** One finished receipt handed to {@link GasUsageTable.record}. */
export interface GasUsageEntry {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    gasUsed: bigint;
    reverted: boolean;
}

/** One aggregated (contract, function) row of a gas usage snapshot. */
export interface GasUsageRow {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    /** Mined transactions, reverted ones included. */
    minedCount: number;
    /** How many of `minedCount` came back with receipt status 0. */
    revertedCount: number;
    /** Decimal strings: a raw bigint must never reach `JSON.stringify`. */
    totalGasUsed: string;
    minGasUsed: string;
    maxGasUsed: string;
}

/** Running totals behind one snapshot row. */
interface GasUsageAggregate {
    contractAddress: ChecksumAddress;
    functionSelector: FunctionSelector;
    functionName: string;
    minedCount: number;
    revertedCount: number;
    totalGasUsed: bigint;
    minGasUsed: bigint;
    maxGasUsed: bigint;
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
 * A reverted transaction is a mined transaction that burned real gas, so it
 * counts in `minedCount`, `totalGasUsed` and the min/max, and `revertedCount`
 * says how many of those mined transactions reverted.
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
                minedCount: 0,
                revertedCount: 0,
                totalGasUsed: 0n,
                minGasUsed: entry.gasUsed,
                maxGasUsed: entry.gasUsed
            };
            this.aggregates.set(key, aggregate);
        }
        aggregate.minedCount += 1;
        if (entry.reverted) aggregate.revertedCount += 1;
        aggregate.totalGasUsed += entry.gasUsed;
        if (entry.gasUsed < aggregate.minGasUsed)
            aggregate.minGasUsed = entry.gasUsed;
        if (entry.gasUsed > aggregate.maxGasUsed)
            aggregate.maxGasUsed = entry.gasUsed;
    }

    /** Rows ordered by contract address, then function name, then selector. */
    public snapshot(): GasUsageRow[] {
        return [...this.aggregates.values()]
            .map((aggregate) => ({
                contractAddress: aggregate.contractAddress,
                functionSelector: aggregate.functionSelector,
                functionName: aggregate.functionName,
                minedCount: aggregate.minedCount,
                revertedCount: aggregate.revertedCount,
                totalGasUsed: aggregate.totalGasUsed.toString(),
                minGasUsed: aggregate.minGasUsed.toString(),
                maxGasUsed: aggregate.maxGasUsed.toString()
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
