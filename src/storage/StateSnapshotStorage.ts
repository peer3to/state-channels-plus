import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";

type StateSnapshotHash = Hash;

export class StateSnapshotStorage {
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshotStruct>;

    constructor() {
        this.snapshotsByHash = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Store snapshot with auto-computed hash */
    storeStateSnapshot(snapshot: StateSnapshotStruct): StateSnapshotHash;

    /** [OVERLOAD 2] Store snapshot with provided hash */
    storeStateSnapshot(
        snapshot: StateSnapshotStruct,
        snapshotHash: StateSnapshotHash
    ): StateSnapshotHash;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeStateSnapshot(
        snapshot: StateSnapshotStruct,
        snapshotHash?: StateSnapshotHash
    ): StateSnapshotHash {
        const hash =
            snapshotHash ??
            ethers.keccak256(Codec.encode(snapshot, Type.StateSnapshot));
        this.snapshotsByHash.set(hash, snapshot);
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
    ): StateSnapshotStruct | undefined {
        return this.snapshotsByHash.get(snapshotHash);
    }
}
