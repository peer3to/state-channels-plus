import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream
} from "./backfillBlocks/ABackfillBlockSource";
import {
    type AccountAddress,
    type StorageSlot,
    type StorageWord
} from "./blockStorageDiff";
import { touchesOf } from "./traceDiffs";
import { UpstreamRequestError } from "./UpstreamRpcClient";
import { toQuantity } from "ethers";

/** Values read in one batch. */
const STATE_BATCH = 200;
/** Blocks traced in one batch. */
const TRACE_BATCH = 8;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

export { ChainMovedError, type BackfillUpstream };

/** What a backfill cost, in upstream requests and round trips. */
export interface BackfillCost {
    /** `eth_getCode` calls of the search for the deploy block. */
    codeProbes: number;
    /** `eth_getBlockByNumber` calls that listed the blocks. */
    blockReads: number;
    /** Child trie root reads that found the changed blocks. */
    rootReads: number;
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
    private readonly blocks: ABackfillBlockSource;
    private readonly cost: BackfillCost = {
        codeProbes: 0,
        blockReads: 0,
        rootReads: 0,
        traces: 0,
        stateReads: 0,
        roundTrips: 0
    };

    constructor(
        upstream: BackfillUpstream,
        address: AccountAddress,
        blocks: ABackfillBlockSource
    ) {
        this.upstream = upstream;
        this.address = address;
        this.blocks = blocks;
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
        const listing = await this.blocks.listBlocks(
            this.upstream,
            this.address,
            from,
            tip,
            parentHash
        );
        this.cost.blockReads += listing.blockReads;
        this.cost.rootReads += listing.rootReads;
        this.cost.roundTrips += listing.roundTrips;
        const keys = await this.traceKeys(listing.numbers);
        return {
            from,
            through: tip,
            keys,
            blocks: listing.blocks,
            tracedBlocks: listing.numbers.length
        };
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
        counter: "traces"
    ): Promise<unknown[]> {
        this.cost[counter] += calls.length;
        this.cost.roundTrips++;
        return await Promise.all(this.upstream.requestBatch(calls));
    }
}
