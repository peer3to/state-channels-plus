import {
    mergeTransactionDiffs,
    parseHeader,
    toQuantity,
    type AccountAddress,
    type StorageSlot,
    type StorageWord
} from "./blockStorageDiff";

/** Blocks asked for in one batch when listing which ones have transactions. */
const BLOCK_BATCH = 100;
/** Blocks traced in one batch. */
const TRACE_BATCH = 8;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

/** The chain changed under the range being read; the range is read again. */
export class ChainMovedError extends Error {}

/** What the backfill reads from the upstream. */
export interface BackfillUpstream {
    request(method: string, params: unknown[]): Promise<unknown>;
    requestBatch(
        calls: { method: string; params: unknown[] }[]
    ): Promise<unknown>[];
}

/** What a backfill cost, in upstream requests and round trips. */
export interface BackfillCost {
    /** `eth_getCode` calls of the search for the deploy block. */
    codeProbes: number;
    /** `eth_getBlockByNumber` calls that listed the blocks. */
    blockReads: number;
    /** `debug_traceBlockByNumber` calls. */
    traces: number;
    /** Frames sent: a batch array is one. */
    roundTrips: number;
}

/** A contract's storage from its deploy block through `through`. */
export interface BackfilledStorage {
    /** First block with the contract's code. */
    deployBlock: bigint;
    /** Last block applied. */
    through: { number: bigint; hash: string };
    /** Every slot written in the range, with its last value. */
    storage: Record<StorageSlot, StorageWord>;
    cost: BackfillCost;
    /** Blocks in the range, and how many of them had transactions. */
    blocks: number;
    tracedBlocks: number;
}

/**
 * Rebuilds the storage of one contract by reading its history: the deploy
 * block is found by bisecting `eth_getCode`, and the prestate trace of every
 * block that has transactions is folded in order. Never-written slots are
 * zero, so the result is the complete storage.
 */
export class ContractBackfill {
    private readonly upstream: BackfillUpstream;
    private readonly address: AccountAddress;
    private readonly cost: BackfillCost = {
        codeProbes: 0,
        blockReads: 0,
        traces: 0,
        roundTrips: 0
    };

    constructor(upstream: BackfillUpstream, address: AccountAddress) {
        this.upstream = upstream;
        this.address = address;
    }

    /**
     * The first block of 0..`tip` whose state has the contract's code, or
     * undefined when `tip` has none. One probe at `tip`, then a bisection.
     */
    async findDeployBlock(tip: bigint): Promise<bigint | undefined> {
        if (!(await this.hasCode(tip))) return undefined;
        let low = 0n;
        let high = tip;
        while (low < high) {
            const middle = (low + high) / 2n;
            if (await this.hasCode(middle)) high = middle;
            else low = middle + 1n;
        }
        return high;
    }

    /** Applies the traces of blocks `from`..`tip.number` that have transactions. */
    async storageThrough(
        from: bigint,
        tip: { number: bigint; hash: string },
        parentHash?: string
    ): Promise<BackfilledStorage> {
        const storage: Record<StorageSlot, StorageWord> = {};
        let blocks = 0;
        let tracedBlocks = 0;
        let previousHash = parentHash;
        for (
            let start = from;
            start <= tip.number;
            start += BigInt(BLOCK_BATCH)
        ) {
            const end =
                start + BigInt(BLOCK_BATCH) - 1n < tip.number
                    ? start + BigInt(BLOCK_BATCH) - 1n
                    : tip.number;
            const numbers: bigint[] = [];
            for (let n = start; n <= end; n++) numbers.push(n);
            const listed = await this.batch(
                numbers.map((number) => ({
                    method: "eth_getBlockByNumber",
                    params: [toQuantity(number), false]
                })),
                "blockReads"
            );
            const withTransactions: bigint[] = [];
            for (const block of listed) {
                const header = parseHeader(block);
                // the listing must be one chain, or it was read across a reorg
                if (
                    previousHash !== undefined &&
                    header.parentHash !== previousHash
                )
                    throw new ChainMovedError(
                        "The chain moved while its blocks were listed"
                    );
                previousHash = header.hash;
                blocks++;
                if (header.txCount > 0) withTransactions.push(header.number);
            }
            for (let i = 0; i < withTransactions.length; i += TRACE_BATCH) {
                const group = withTransactions.slice(i, i + TRACE_BATCH);
                const traces = await this.batch(
                    group.map((number) => ({
                        method: "debug_traceBlockByNumber",
                        params: [toQuantity(number), TRACE_OPTIONS]
                    })),
                    "traces"
                );
                for (const trace of traces) {
                    const written =
                        mergeTransactionDiffs(trace).post[this.address];
                    Object.assign(storage, written?.storage);
                    tracedBlocks++;
                }
            }
        }
        if (previousHash !== tip.hash)
            throw new ChainMovedError(
                "The range does not end at the expected block"
            );
        return {
            deployBlock: from,
            through: tip,
            storage,
            cost: { ...this.cost },
            blocks,
            tracedBlocks
        };
    }

    /** The requests and round trips made so far. */
    get spent(): BackfillCost {
        return { ...this.cost };
    }

    private async hasCode(block: bigint): Promise<boolean> {
        this.cost.codeProbes++;
        this.cost.roundTrips++;
        const code = await this.upstream.request("eth_getCode", [
            this.address,
            toQuantity(block)
        ]);
        return typeof code === "string" && code !== "0x";
    }

    private async batch(
        calls: { method: string; params: unknown[] }[],
        counter: "blockReads" | "traces"
    ): Promise<unknown[]> {
        this.cost[counter] += calls.length;
        this.cost.roundTrips++;
        return await Promise.all(this.upstream.requestBatch(calls));
    }
}
