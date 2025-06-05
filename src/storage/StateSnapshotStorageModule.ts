import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
import { IStateSnapshotStorageModule } from "./interfaces/IStateSnapshotStorageModule";
import { StateSnapshotHash } from "@/types/storage";

export class StateSnapshotStorageModule implements IStateSnapshotStorageModule {
    //map [stateSnapshotHash]=> struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<
        StateSnapshotHash,
        StateSnapshotStruct
    >;
    //could be replaced with a key, but we would need some computation
    private cachedOnChainStateSnapshot: {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    };

    constructor() {
        this.stateSnapshotStructsMap = new Map();
        //TODO: This should be replaced by the actual genesis state snapshot
        this.cachedOnChainStateSnapshot = {
            stateSnapshot: {
                stateMachineStateHash: "0x",
                participants: [],
                forkCnt: 0,
                latestJoinChannelBlockHash: "0x",
                latestExitChannelBlockHash: "0x",
                totalDeposits: {
                    amount: BigInt(0),
                    data: "0x"
                },
                totalWithdrawals: {
                    amount: BigInt(0),
                    data: "0x"
                }
            },
            timestamp: 0
        };
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

    getCachedOnChainStateSnapshot(): {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    } {
        return this.cachedOnChainStateSnapshot;
    }

    setCachedOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void {
        this.cachedOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }

    private makeKey(forkCnt: number, blockHeight: number): StateSnapshotHash {
        return `${forkCnt}-${blockHeight}`;
    }
}
