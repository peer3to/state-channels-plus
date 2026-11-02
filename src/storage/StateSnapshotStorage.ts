import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import StateSnapshot from "@/models/StateSnapshot";
import type { ForkId, Hash } from "@/types/types";

type StateSnapshotHash = Hash;
type StoreOptions = {
    hash?: StateSnapshotHash;
};

export class StateSnapshotStorage {
    private readonly snapshotsByHash: PersistentCollection<
        StateSnapshotHash,
        StateSnapshot
    >;

    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    private readonly genesisSnapshotByForkId = new Map<
        ForkId,
        StateSnapshotHash
    >();

    constructor(controller?: PersistenceController) {
        this.snapshotsByHash = new PersistentCollection(
            "stateSnapshots",
            controller,
            () => this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeStateSnapshot(
        snapshot: StateSnapshot,
        options?: StoreOptions
    ): StateSnapshotHash {
        const hash = options?.hash ?? snapshot.hash;
        this.snapshotsByHash.set(hash, snapshot);
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get a state snapshot by its hash
     */
    public getStateSnapshotByHash(
        snapshotHash: StateSnapshotHash
    ): StateSnapshot | undefined {
        return this.snapshotsByHash.get(snapshotHash);
    }

    public getGenesisSnapshotByForkId(
        forkId: ForkId
    ): StateSnapshot | undefined {
        const hash = this.genesisSnapshotByForkId.get(forkId);
        return hash ? this.snapshotsByHash.get(hash) : undefined;
    }

    public getSnapshotCount(): number {
        return this.snapshotsByHash.size;
    }

    public rebuildIndexes(): void {
        this.genesisSnapshotByForkId.clear();
        for (const [hash, snapshot] of this.snapshotsByHash.entries()) {
            if (snapshot.isGenesis) {
                this.genesisSnapshotByForkId.set(snapshot.forkID, hash);
            }
        }
    }
}
