import { ethers } from "ethers";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { IBlockStorageModule } from "./interfaces/IBlockStorage";
import { BlockHash } from "@/types/storage";

export class BlockStorageModule implements IBlockStorageModule {
    //BlockConfirmationStruct => SignedBlockStruct => encodedBlock => BlockStruct
    private blockConfirmationStructsMap: Map<
        BlockHash,
        BlockConfirmationStruct
    >;

    constructor() {
        this.blockConfirmationStructsMap = new Map();
    }

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined {
        // TODO
        return ethers.ZeroHash;
    }
}
