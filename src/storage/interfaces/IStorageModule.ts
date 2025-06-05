import { IBlockStorageModule } from "./IBlockStorageModule";
import { IJoinChannelStorageModule } from "./IJoinChannelStorageModule";
import { IExitChannelStorageModule } from "./IExitChannelStorageModule";
import { IStateSnapshotStorageModule } from "./IStateSnapshotStorageModule";

export interface IStorageModule
    extends IBlockStorageModule,
        IJoinChannelStorageModule,
        IExitChannelStorageModule,
        IStateSnapshotStorageModule {}
