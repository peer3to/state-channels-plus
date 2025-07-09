import { Hash, ForkId } from "@/types/types";
import StateSnapshot from "@/models/StateSnapshot";

type StateSnapshotHash = Hash;

export class StateSnapshotStorage {
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshot>;
    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    private genesisSnapshotDataByForkId: Map<ForkId, StateSnapshot>;

    constructor() {
        this.snapshotsByHash = new Map();
        this.genesisSnapshotDataByForkId = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Store snapshot with auto-computed hash */
    storeStateSnapshot(snapshot: StateSnapshot): StateSnapshotHash;

    /** [OVERLOAD 2] Store snapshot with provided hash */
    storeStateSnapshot(
        snapshot: StateSnapshot,
        snapshotHash: StateSnapshotHash
    ): StateSnapshotHash;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeStateSnapshot(
        snapshot: StateSnapshot,
        snapshotHash?: StateSnapshotHash
    ): StateSnapshotHash {
        const hash = snapshotHash ?? snapshot.hash;

        this.snapshotsByHash.set(hash, snapshot);

        if (snapshot.isGenesis) {
            this.genesisSnapshotDataByForkId.set(snapshot.forkId, snapshot);
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

    getGenesisSnapshotDataByForkId(forkId: ForkId): StateSnapshot | undefined {
        return this.genesisSnapshotDataByForkId.get(forkId);
    }
}
