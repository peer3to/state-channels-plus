import StateSnapshot from "@/models/StateSnapshot";
import { Hash, ForkId } from "@/types/types";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";

type StateSnapshotHash = Hash;

type StoreOptions = {
    hash?: StateSnapshotHash;
    blockResult?: boolean; // a block's resulting snapshot: never a fork genesis
};

export class StateSnapshotStorage {
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshot>;
    // Store genesis SnapshotData by forkId (forkId = hash(snapshotData)
    // First registration wins; a conflicting one is refused.
    private genesisSnapshotByForkId: Map<ForkId, StateSnapshot>;
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.snapshotsByHash = new Map();
        this.genesisSnapshotByForkId = new Map();
        this.logger = logger.child({ component: "StateSnapshotStorage" });
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

        if (!options?.blockResult && snapshot.isGenesis) {
            this.registerGenesis(snapshot);
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

    // ====================================
    // PRIVATE
    // ====================================

    // A block that changes no state has genesis-shaped snapshotData. Callers
    // storing a block's result say so (blockResult); for any other store only
    // height 0 is a genesis, so a later unchanged state is stored by hash only.
    // A genesis fork id pins its snapshotData, so the full snapshot hash of
    // two height-0 snapshots differs exactly when their timestamps differ.
    private registerGenesis(snapshot: StateSnapshot): void {
        if (snapshot.blockHeight !== 0) return;
        const registered = this.genesisSnapshotByForkId.get(snapshot.forkID);
        if (!registered) {
            this.genesisSnapshotByForkId.set(snapshot.forkID, snapshot);
            return;
        }
        if (registered.hash === snapshot.hash) return;

        this.logger.warn(
            "Refused conflicting genesis snapshot for a registered fork id",
            {
                registered: LoggerUtils.getSnapshotMetadata(registered),
                refused: LoggerUtils.getSnapshotMetadata(snapshot)
            }
        );
    }
}
