import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
export interface IStateSnapshotStorageModule {
    storeStateSnapshot(snapshot: StateSnapshotStruct): void;
    getStateSnapshot(
        forkCnt: number,
        blockHeight: number
    ): StateSnapshotStruct | undefined;
    getCachedOnChainStateSnapshot(): {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    };
    setCachedOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void;
}
