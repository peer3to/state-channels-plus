import type { AccountAddress } from "../blockStorageDiff";
import type RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import type { Logger } from "@/utils";

/**
 * What a backfill reads with. Every request waits for a free place among the
 * service's state reads in flight and times out like the service's own.
 */
export interface BackfillUpstream {
    /** One request to the service's upstream. */
    request(method: string, params: unknown[]): Promise<unknown>;
    /** One request to another node the source connected to. */
    requestOn(
        node: RpcNodeProvider,
        method: string,
        params: unknown[]
    ): Promise<unknown>;
    /** The service's logger, for the connections a source opens. */
    logger: Logger;
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
        upstream: BackfillUpstream,
        address: AccountAddress,
        at: { number: bigint }
    ): Promise<number | undefined>;

    /** Idempotent: drops connections the source opened. */
    public abstract close(): void;
}
