import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
import { StateSnapshotHash } from "@/types/storage";

export class StateSnapshotStorageModule {
    //map [stateSnapshotHash]=> struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<
        StateSnapshotHash,
        StateSnapshotStruct
    >;

    constructor() {
        this.stateSnapshotStructsMap = new Map();
    }

    /**
     * Store a state snapshot
     */
    storeStateSnapshot(snapshot: StateSnapshotStruct) {
        const stateSnapshotHash = ethers.keccak256(
            Codec.encode(snapshot, Type.StateSnapshot)
        );
        this.stateSnapshotStructsMap.set(stateSnapshotHash, snapshot);
    }

    /**
     * Retrieve a state snapshot
     */
    getStateSnapshot(
        forkCnt: number,
        blockHeight: number
    ): StateSnapshotStruct | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.stateSnapshotStructsMap.get(key);
    }

    getStateSnapshotByHash(
        stateSnapshotHash: StateSnapshotHash
    ): StateSnapshotStruct | undefined {
        return this.stateSnapshotStructsMap.get(stateSnapshotHash);
    }

    private makeKey(forkCnt: number, blockHeight: number): StateSnapshotHash {
        return `${forkCnt}-${blockHeight}`;
    }
}
