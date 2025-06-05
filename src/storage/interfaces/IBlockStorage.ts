import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockHash } from "@/types/storage";
import { BlockConfirmation } from "@/agreementManager/types";

export interface IBlockStorageModule {
    insertBlock(signedBlock: SignedBlockStruct): void;
    insertBlock(
        signedBlock: SignedBlockStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void;
    insertBlock(blockConfirmation: BlockConfirmationStruct): void;
    insertBlock(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void;
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined;
    getBlockConfirmation(
        blockHash: BlockHash
    ): BlockConfirmationStruct | undefined;
    getBlockConfirmation(
        fork: number,
        height: number
    ): BlockConfirmationStruct | undefined;
    deleteBlockConfirmation(blockHash: BlockHash): void;
    deleteBlockConfirmation(fork: number, height: number): void;
}
