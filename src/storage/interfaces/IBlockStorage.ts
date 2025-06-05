import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockHash } from "@/types/storage";

export interface IBlockStorageModule {
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined;
}
