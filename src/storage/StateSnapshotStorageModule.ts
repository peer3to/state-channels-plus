import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
import { IStateSnapshotStorageModule } from "./interfaces/IStateSnapshotStorageModule";

export class StateSnapshotStorageModule implements IStateSnapshotStorageModule {
    //map [stateSnapshotHash]=> struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<string, StateSnapshotStruct>;
    //could be replaced with a key, but we would need some computation
    private latestOnChainStateSnapshot: {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    };

    constructor() {
        this.stateSnapshotStructsMap = new Map();
        //TODO: This should be replaced by the actual genesis state snapshot
        this.latestOnChainStateSnapshot = {
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

    getCachedOnChainSnapshot(): {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    } {
        return this.latestOnChainStateSnapshot;
    }

    setLatestOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void {
        this.latestOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }

    private makeKey(forkCnt: number, blockHeight: number): string {
        return `${forkCnt}-${blockHeight}`;
    }
}
