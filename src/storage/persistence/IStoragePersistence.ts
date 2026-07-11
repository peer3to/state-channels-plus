import { Hash, ForkId, BlockHeight } from "@/types/types";

export type BlockPersistenceKey = {
    hash: Hash;
    forkId: ForkId;
    height: BlockHeight;
};

/**
 * Async write-through persistence port sitting behind a store's synchronous
 * in-memory read API. Reads never go through this port - only writes (fire
 * and forget) and startup hydration (`loadAll`) do.
 */
export interface IStoragePersistence {
    /** Write-through upsert keyed by `key.hash`. Async internally; must never reject into the caller. */
    persistBlock(encodedBlock: string, key: BlockPersistenceKey): void;
    deleteBlock(key: { hash: Hash }): void;
    /** Used by `hydrate()` to repopulate the in-memory maps. Order-independent. */
    loadAll(): AsyncIterable<{ encodedBlock: string }>;
    onError?: (err: unknown) => void;
}
