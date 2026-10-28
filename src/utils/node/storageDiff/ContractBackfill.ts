import {
    touchesOf,
    parseHeader,
    toQuantity,
    type AccountAddress,
    type StorageSlot,
    type StorageWord
} from "./blockStorageDiff";
import { UpstreamRequestError } from "./UpstreamRpcClient";

/** Blocks asked for in one batch when listing which ones have transactions. */
const BLOCK_BATCH = 100;
/** Values read in one batch. */
const STATE_BATCH = 200;
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
    /** Reads of the final balance, nonce, code and slot values. */
    stateReads: number;
    /** Frames sent: a batch array is one. */
    roundTrips: number;
}

/** The storage keys a contract touched from its deploy block through `through`. */
export interface BackfilledKeys {
    /** First block of the range read. */
    from: bigint;
    /** Last block of the range read. */
    through: { number: bigint; hash: string };
    /** Every slot the traces name for the contract. */
    keys: Set<StorageSlot>;
    /** Blocks in the range, and how many of them had transactions. */
    blocks: number;
    tracedBlocks: number;
}

/** A contract's state as the node reports it at one block. */
export interface BackfilledState {
    balance: string;
    nonce: string;
    code: string;
    /** The slots read, zero words left out. */
    storage: Record<StorageSlot, StorageWord>;
}

/**
 * Rebuilds the state of one contract from its history: the deploy block is
 * found by bisecting `eth_getCode`, the prestate trace of every block that has
 * transactions names the keys the contract touched, and the values of all of
 * them are read at one block. A trace is only used for which keys, never for
 * what is in them. Never-touched slots are zero, so the result is complete.
 */
export class ContractBackfill {
    private readonly upstream: BackfillUpstream;
    private readonly address: AccountAddress;
    private readonly cost: BackfillCost = {
        codeProbes: 0,
        blockReads: 0,
        traces: 0,
        stateReads: 0,
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

    /** The keys the traces of blocks `from`..`tip.number` that have transactions name. */
    async keysThrough(
        from: bigint,
        tip: { number: bigint; hash: string },
        parentHash?: string
    ): Promise<BackfilledKeys> {
        const keys = new Set<StorageSlot>();
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
            for (const slot of await this.traceKeys(withTransactions))
                keys.add(slot);
            tracedBlocks += withTransactions.length;
        }
        if (previousHash !== tip.hash)
            throw new ChainMovedError(
                "The range does not end at the expected block"
            );
        return { from, through: tip, keys, blocks, tracedBlocks };
    }

    /** The slots the contract's traces name in blocks `numbers`. */
    async traceKeys(numbers: bigint[]): Promise<Set<StorageSlot>> {
        const keys = new Set<StorageSlot>();
        for (let i = 0; i < numbers.length; i += TRACE_BATCH) {
            const traces = await this.batch(
                numbers.slice(i, i + TRACE_BATCH).map((number) => ({
                    method: "debug_traceBlockByNumber",
                    params: [toQuantity(number), TRACE_OPTIONS]
                })),
                "traces"
            );
            for (const trace of traces)
                for (const slot of touchesOf(trace)[this.address]?.slots ?? [])
                    keys.add(slot);
        }
        return keys;
    }

    /**
     * The contract's balance, nonce and code, and the value of each of `keys`,
     * at block `blockHash`, in batches.
     */
    async readState(
        blockHash: string,
        keys: Iterable<StorageSlot>
    ): Promise<BackfilledState> {
        const at = { blockHash };
        const slots = [...keys];
        const calls = [
            ...(
                [
                    "eth_getBalance",
                    "eth_getTransactionCount",
                    "eth_getCode"
                ] as const
            ).map((method) => ({ method, params: [this.address, at] })),
            ...slots.map((slot) => ({
                method: "eth_getStorageAt",
                params: [this.address, slot, at]
            }))
        ];
        const answers: unknown[] = [];
        for (let i = 0; i < calls.length; i += STATE_BATCH) {
            this.cost.stateReads += Math.min(STATE_BATCH, calls.length - i);
            this.cost.roundTrips++;
            answers.push(
                ...(await Promise.all(
                    this.upstream.requestBatch(calls.slice(i, i + STATE_BATCH))
                ))
            );
        }
        const [balance, nonce, code, ...words] = answers as string[];
        const storage: Record<StorageSlot, StorageWord> = {};
        slots.forEach((slot, i) => {
            const word =
                "0x" + words[i].slice(2).padStart(64, "0").toLowerCase();
            if (BigInt(word) !== 0n) storage[slot] = word;
        });
        return { balance, nonce, code: code.toLowerCase(), storage };
    }

    /** The requests and round trips made so far. */
    get spent(): BackfillCost {
        return { ...this.cost };
    }

    private async hasCode(block: bigint): Promise<boolean> {
        this.cost.codeProbes++;
        this.cost.roundTrips++;
        try {
            const code = await this.upstream.request("eth_getCode", [
                this.address,
                toQuantity(block)
            ]);
            return typeof code === "string" && code !== "0x";
        } catch (error) {
            // Asset Hub answers "not supported at the queried block" before
            // its contracts pallet existed: no code there
            if (error instanceof UpstreamRequestError) return false;
            throw error;
        }
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
