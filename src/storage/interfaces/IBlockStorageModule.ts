import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";

export interface IBlockStorageModule {
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined;
    getLatestBlock(): SignedBlockStruct;
    getLatestBlockConfirmation(): BlockConfirmationStruct;
}
