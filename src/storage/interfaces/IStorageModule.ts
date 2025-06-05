import { IBlockStorageModule } from "./IBlockStorageModule";
import { IJoinChannelStorageModule } from "./IJoinChannelStorageModule";
import { IExitChannelStorageModule } from "./IExitChannelStorageModule";
import { IStateSnapshotStorageModule } from "./IStateSnapshotStorageModule";
import {
    BlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BytesLike } from "ethers";

export interface IStorageModule
    extends IBlockStorageModule,
        IJoinChannelStorageModule,
        IExitChannelStorageModule,
        IStateSnapshotStorageModule {
    getLatestBlock(): {
        stateSnapshot: StateSnapshotStruct;
        block: BlockStruct;
        signature: BytesLike;
    };
}
