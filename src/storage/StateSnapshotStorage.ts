import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import StateSnapshot from "@/models/StateSnapshot";
import { Hash, ForkId } from "@/types/types";

type StateSnapshotHash = Hash;
type HeadKey = "value";

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
    // the fork of the installed state; fork heights restart at 0, so it is not derived
    private readonly headForkId: PersistentCollection<HeadKey, ForkId>;

    constructor(controller?: PersistenceController) {
        this.snapshotsByHash = new PersistentCollection(
            "stateSnapshots",
            controller,
            () => this.rebuildIndexes()
        );
        this.headForkId = new PersistentCollection("headFork", controller);
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
            this.genesisSnapshotByForkId.set(snapshot.forkID, hash);
        }

        return hash;
    }

    storeHeadForkId(forkId: ForkId): void {
        this.headForkId.set("value", forkId);
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
        const hash = this.genesisSnapshotByForkId.get(forkId);
        return hash === undefined ? undefined : this.snapshotsByHash.get(hash);
    }

    getHeadForkId(): ForkId | undefined {
        return this.headForkId.get("value");
    }

    // after a load, in store order: the latest stored genesis per fork
    private rebuildIndexes(): void {
        this.genesisSnapshotByForkId.clear();
        for (const [hash, snapshot] of this.snapshotsByHash.entries()) {
            if (snapshot.isGenesis) {
                this.genesisSnapshotByForkId.set(snapshot.forkID, hash);
            }
        }
    }
}
