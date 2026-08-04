import { Hash, ForkId } from "@/types/types";
import StateSnapshot from "@/models/StateSnapshot";
import { DirtyKeyTracker } from "./persistence/DirtyKeyTracker";

type StateSnapshotHash = Hash;

type StoreOptions = {
    hash?: StateSnapshotHash;
};

export class StateSnapshotStorage {
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshot>;
    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    private genesisSnapshotByForkId: Map<ForkId, StateSnapshot>;

    // Memory-only: hashes touched since the last successful flush (PO1
    // bounded diff - this store is appended every signed block for the life
    // of a channel, so a full scan would grow unbounded). Snapshots are
    // content-addressed and never mutated in place after insertion, so a
    // revisioned re-add is only ever the same content - no RR1-style race.
    private dirtyHashes: DirtyKeyTracker<StateSnapshotHash>;

    constructor() {
        this.snapshotsByHash = new Map();
        this.genesisSnapshotByForkId = new Map();
        this.dirtyHashes = new DirtyKeyTracker();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /**
     * The persistence engine's view of this store's PRIMARY map.
     * genesisSnapshotByForkId is derived (same instances) and rebuilt on
     * replay via storeStateSnapshot.
     */
    *persistableEntries(): Iterable<[StateSnapshotHash, StateSnapshot]> {
        yield* this.snapshotsByHash;
    }

    /** Single-key equivalent of persistableEntries(). */
    getPersistableEntry(hash: StateSnapshotHash): StateSnapshot | undefined {
        return this.snapshotsByHash.get(hash);
    }

    /** Peek (hash, revision) pairs touched since the last successful flush, without clearing. */
    peekDirtyHashes(): Iterable<readonly [StateSnapshotHash, number]> {
        return this.dirtyHashes.peek();
    }

    /** Clears exactly the peeked (hash, revision) pairs - called only after their diff committed. */
    clearDirtyHashes(
        entries: Iterable<readonly [StateSnapshotHash, number]>
    ): void {
        this.dirtyHashes.clear(entries);
    }

    // ====================================
    // CREATE
    // ====================================

    storeStateSnapshot(
        snapshot: StateSnapshot,
        options?: StoreOptions
    ): StateSnapshotHash {
        const hash = options?.hash ?? snapshot.hash;

        this.snapshotsByHash.set(hash, snapshot);

        if (snapshot.isGenesis) {
            this.genesisSnapshotByForkId.set(snapshot.forkID, snapshot);
        }

        this.dirtyHashes.markDirty(hash);
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get a state snapshot by its hash
     */
    getStateSnapshotByHash(
        snapshotHash: StateSnapshotHash
    ): StateSnapshot | undefined {
        return this.snapshotsByHash.get(snapshotHash);
    }

    getGenesisSnapshotByForkId(forkId: ForkId): StateSnapshot | undefined {
        return this.genesisSnapshotByForkId.get(forkId);
    }
}
