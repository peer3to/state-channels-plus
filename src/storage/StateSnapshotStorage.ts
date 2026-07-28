import StateSnapshot from "@/models/StateSnapshot";
import type { ForkId, Hash } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type StateSnapshotHash = Hash;
type StoreOptions = {
    hash?: StateSnapshotHash;
};

export class StateSnapshotStorage {
    private readonly snapshots: PersistentCollection<
        StateSnapshotHash,
        StateSnapshot
    >;

    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    private readonly genesisSnapshotByForkId = new Map<
        ForkId,
        StateSnapshotHash
    >();

    constructor(controller?: PersistenceController) {
        this.snapshots = new PersistentCollection(
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
        this.snapshots.update(hash, (existing) => {
            const existingGenesis = this.genesisSnapshotByForkId.get(
                snapshot.forkID
            );
            if (
                snapshot.isGenesis &&
                existingGenesis &&
                existingGenesis !== hash
            ) {
                throw new Error(
                    `Conflicting genesis snapshots for fork ${snapshot.forkID}`
                );
            }
            if (existing && existing.encode() !== snapshot.encode()) {
                throw new Error(`Incompatible state snapshot for hash ${hash}`);
            }
            return snapshot;
        });
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
        return this.snapshots.get(snapshotHash);
    }

    public getGenesisSnapshotByForkId(
        forkId: ForkId
    ): StateSnapshot | undefined {
        const hash = this.genesisSnapshotByForkId.get(forkId);
        return hash ? this.snapshots.get(hash) : undefined;
    }

    public getSnapshotCount(): number {
        return this.snapshots.size;
    }

    public rebuildIndexes(): void {
        this.genesisSnapshotByForkId.clear();
        for (const [hash, snapshot] of this.snapshots.entries()) {
            if (snapshot.isGenesis) {
                const existingHash = this.genesisSnapshotByForkId.get(
                    snapshot.forkID
                );
                if (existingHash && existingHash !== hash) {
                    throw new Error(
                        `Conflicting genesis snapshots for fork ${snapshot.forkID}`
                    );
                }
                this.genesisSnapshotByForkId.set(snapshot.forkID, hash);
            }
        }
    }
}
