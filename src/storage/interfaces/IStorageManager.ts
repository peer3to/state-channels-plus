import {
    BlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { BytesLike } from "ethers";

export interface IStorageModule {
    getLatestBlock(): {
        stateSnapshot: StateSnapshotStruct;
        block: BlockStruct;
        signature: BytesLike;
    };
}
