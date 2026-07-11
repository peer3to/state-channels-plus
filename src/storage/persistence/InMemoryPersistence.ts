import { Hash } from "@/types/types";
import {
    BlockPersistenceKey,
    IStoragePersistence
} from "./IStoragePersistence";

/**
 * Default persistence backing: keeps a second in-memory copy, write-through.
 * Behaviourally a no-op for the read model (BlockStorage's own maps stay the
 * source of truth) - this only exists so `hydrate()` has something to load
 * from when no platform-specific persistence (IndexedDB/Node, be-04/be-05)
 * has been wired in yet.
 */
export class InMemoryPersistence implements IStoragePersistence {
    private readonly encodedBlocksByHash = new Map<Hash, string>();

    persistBlock(encodedBlock: string, key: BlockPersistenceKey): void {
        this.encodedBlocksByHash.set(key.hash, encodedBlock);
    }

    deleteBlock(key: { hash: Hash }): void {
        this.encodedBlocksByHash.delete(key.hash);
    }

    async *loadAll(): AsyncIterable<{ encodedBlock: string }> {
        for (const encodedBlock of this.encodedBlocksByHash.values()) {
            yield { encodedBlock };
        }
    }
}
