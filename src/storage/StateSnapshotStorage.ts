import { Hash, ForkId } from "@/types/types";
import StateSnapshot from "@/models/StateSnapshot";

type StateSnapshotHash = Hash;

type StoreOptions = {
    hash?: StateSnapshotHash;
};

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

    storeStateSnapshot(
        snapshot: StateSnapshot,
        options?: StoreOptions
    ): StateSnapshotHash | undefined {
        const hash = options?.hash ?? snapshot.hash;

        // Check if the same snapshot already exists
        const existingSnapshot = this.snapshotsByHash.get(hash);
        if (existingSnapshot) {
            if (existingSnapshot.forkId === snapshot.forkId &&
                existingSnapshot.snapshotData.stateMachineStateHash === snapshot.snapshotData.stateMachineStateHash) {
                return hash;
            }
            // Conflict
            return undefined;
        }

        this.snapshotsByHash.set(hash, snapshot);

        if (snapshot.isGenesis) {
            const existingGenesis = this.genesisSnapshotDataByForkId.get(snapshot.forkId);
            if (existingGenesis) {
                if (existingGenesis.hash === snapshot.hash) {
                    return hash;
                }
            }
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
