import StateSnapshot from "@/models/StateSnapshot";
import { BlockHeight, Hash, ForkId } from "@/types/types";

type StateSnapshotHash = Hash;

type StoreOptions = {
    hash?: StateSnapshotHash;
};

export class StateSnapshotStorage {
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshot>;
    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    private genesisSnapshotByForkId: Map<ForkId, StateSnapshot>;

    constructor() {
        this.snapshotsByHash = new Map();
        this.genesisSnapshotByForkId = new Map();
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

    /** The state hashes the held snapshots reference, except those of `excludedSnapshotHashes`. */
    getReferencedStateHashes(
        excludedSnapshotHashes: ReadonlySet<StateSnapshotHash> = new Set()
    ): Set<Hash> {
        const stateHashes = new Set<Hash>();
        for (const [snapshotHash, snapshot] of this.snapshotsByHash)
            if (!excludedSnapshotHashes.has(snapshotHash))
                stateHashes.add(snapshot.stateMachineStateHash);
        return stateHashes;
    }

    // ====================================
    // DELETE
    // ====================================

    /**
     * Deletes the snapshots of `forkId` below `height`; its genesis is kept.
     * Returns the state hashes they referenced.
     */
    deleteSnapshotsBelow(forkId: ForkId, height: BlockHeight): Hash[] {
        return this.deleteSnapshots(
            (snapshot) =>
                snapshot.forkID === forkId &&
                !snapshot.isGenesis &&
                snapshot.blockHeight < height
        );
    }

    /**
     * Deletes every snapshot of `forkId`, its genesis too. Returns the state
     * hashes they referenced.
     */
    deleteFork(forkId: ForkId): Hash[] {
        this.genesisSnapshotByForkId.delete(forkId);
        return this.deleteSnapshots((snapshot) => snapshot.forkID === forkId);
    }

    private deleteSnapshots(
        isDeleted: (snapshot: StateSnapshot) => boolean
    ): Hash[] {
        const stateHashes: Hash[] = [];
        for (const [snapshotHash, snapshot] of this.snapshotsByHash) {
            if (!isDeleted(snapshot)) continue;
            this.snapshotsByHash.delete(snapshotHash);
            stateHashes.push(snapshot.stateMachineStateHash);
        }
        return stateHashes;
    }
}
