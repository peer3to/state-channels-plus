import { IBlockStorageModule } from "./IBlockStorage";
import { IJoinChannelStorageModule } from "./IJoinChannelStorage";
import { IExitChannelStorageModule } from "./IExitChannelStorage";
import { IStateSnapshotStorageModule } from "./IStateSnapshotStorage";
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
