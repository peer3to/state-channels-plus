import type { AccountAddress } from "../blockStorageDiff";

/** What a backfill reads from the upstream. */
export interface BackfillUpstream {
    request(method: string, params: unknown[]): Promise<unknown>;
    requestBatch(
        calls: { method: string; params: unknown[] }[]
    ): Promise<unknown>[];
}

/** The chain changed under the range being read; the range is read again. */
export class ChainMovedError extends Error {}

/** The blocks of a range a contract's history has to be traced in, and what finding them cost. */
export interface BlockListing {
    /** Blocks to trace, ascending. */
    numbers: bigint[];
    /** Blocks the range spans. */
    blocks: number;
    /** `eth_getBlockByNumber` calls. */
    blockReads: number;
    /** Child trie root reads. */
    rootReads: number;
    /** Frames sent. */
    roundTrips: number;
}

/**
 * Where a backfill learns which blocks of a range to trace for one contract.
 * A listing may name blocks that did not touch the contract, but never leaves
 * out one that changed its storage.
 */
export default abstract class ABackfillBlockSource {
    /**
     * The blocks of `from`..`tip.number` to trace. `parentHash` is the hash of
     * block `from - 1` when the caller knows it. Throws `ChainMovedError` when
     * the range does not end at `tip`.
     */
    public abstract listBlocks(
        upstream: BackfillUpstream,
        address: AccountAddress,
        from: bigint,
        tip: { number: bigint; hash: string },
        parentHash?: string
    ): Promise<BlockListing>;

    /**
     * How many non-zero storage entries the chain holds for `address` at
     * block `at`, when the source can count them; undefined when it cannot.
     * A backfill that found another number is not complete.
     */
    public abstract countStorageEntries(
        address: AccountAddress,
        at: { number: bigint }
    ): Promise<number | undefined>;

    /** Idempotent: drops connections the source opened. */
    public abstract close(): void;
}
