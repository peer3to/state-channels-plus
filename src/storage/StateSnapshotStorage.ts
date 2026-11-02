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
        "stateSnapshots"
    >;
    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    // -> the latest stored genesis snapshot's hash: two candidates for one fork can be held
    private readonly genesisSnapshotByForkId: PersistentCollection<
        ForkId,
        "genesisSnapshots"
    >;
    // the fork of the installed state; fork heights restart at 0, so it is not derived
    private readonly headForkId: PersistentCollection<HeadKey, "headFork">;

    constructor(controller?: PersistenceController) {
        this.snapshotsByHash = new PersistentCollection(
            "stateSnapshots",
            controller
        );
        this.genesisSnapshotByForkId = new PersistentCollection(
            "genesisSnapshots",
            controller
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
}
