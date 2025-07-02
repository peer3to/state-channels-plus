import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";

type StateSnapshotHash = Hash;
type BlockOrDisputeHash = Hash;

export class StateSnapshotStorage {
    // Direct access to snapshots by their hash
    private snapshotsByHash: Map<StateSnapshotHash, StateSnapshotStruct>;

    // Map from state transition entity (block/dispute) hash  to the posterior state snapshot
    private snapshotsByTransitionHash: Map<
        BlockOrDisputeHash,
        StateSnapshotStruct
    >;

    constructor() {
        this.snapshotsByHash = new Map();
        this.snapshotsByTransitionHash = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Store snapshot with auto-computed hash */
    storeStateSnapshot(
        snapshot: StateSnapshotStruct,
        blockOrDisputeHash: BlockOrDisputeHash
    ): StateSnapshotHash;

    /** [OVERLOAD 2] Store snapshot with provided hash */
    storeStateSnapshot(
        snapshot: StateSnapshotStruct,
        blockOrDisputeHash: BlockOrDisputeHash,
        snapshotHash: StateSnapshotHash
    ): StateSnapshotHash;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeStateSnapshot(
        snapshot: StateSnapshotStruct,
        blockOrDisputeHash: BlockOrDisputeHash,
        snapshotHash?: StateSnapshotHash
    ): StateSnapshotHash {
        const finalHash =
            snapshotHash ??
            ethers.keccak256(Codec.encode(snapshot, Type.StateSnapshot));
        this.snapshotsByHash.set(finalHash, snapshot);
        this.snapshotsByTransitionHash.set(blockOrDisputeHash, snapshot);
        return finalHash;
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

    /**
     * Get a posterior state snapshot through the hash of the transition entity (block/dispute)
     */
    getPosteriorStateSnapshot(
        transitionHash: BlockOrDisputeHash
    ): StateSnapshotStruct | undefined {
        return this.snapshotsByTransitionHash.get(transitionHash);
    }
}
