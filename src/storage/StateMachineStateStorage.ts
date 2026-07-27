import { Hash, Bytes } from "@/types/types";
import { ethers } from "ethers";
import { DirtyKeyTracker } from "./persistence/DirtyKeyTracker";

type StoreOptions = {
    hash?: Hash;
};

export class StateMachineStateStorage {
    private statesByHash: Map<Hash, Bytes>;

    // Memory-only: hashes touched since the last successful flush (PO1
    // bounded diff - this store is appended every signed block for the life
    // of a channel, so a full scan would grow unbounded). States are
    // content-addressed and never mutated in place after insertion, so a
    // revisioned re-add is only ever the same content - no RR1-style race.
    private dirtyHashes: DirtyKeyTracker<Hash>;

    constructor() {
        this.statesByHash = new Map();
        this.dirtyHashes = new DirtyKeyTracker();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /** The persistence engine's view of this store's PRIMARY map. */
    *persistableEntries(): Iterable<[Hash, Bytes]> {
        yield* this.statesByHash;
    }

    /** Single-key equivalent of persistableEntries(). */
    getPersistableEntry(hash: Hash): Bytes | undefined {
        return this.statesByHash.get(hash);
    }

    /** Peek (hash, revision) pairs touched since the last successful flush, without clearing. */
    peekDirtyHashes(): Iterable<readonly [Hash, number]> {
        return this.dirtyHashes.peek();
    }

    /** Clears exactly the peeked (hash, revision) pairs - called only after their diff committed. */
    clearDirtyHashes(entries: Iterable<readonly [Hash, number]>): void {
        this.dirtyHashes.clear(entries);
    }

    // ====================================
    // CREATE
    // ====================================

    storeStateMachineState(encodedState: Bytes, options?: StoreOptions): Hash {
        const hash = options?.hash ?? ethers.keccak256(encodedState);
        this.statesByHash.set(hash, encodedState);

        this.dirtyHashes.markDirty(hash);
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    getStateMachineState(hash: Hash): Bytes | undefined {
        return this.statesByHash.get(hash);
    }
}
