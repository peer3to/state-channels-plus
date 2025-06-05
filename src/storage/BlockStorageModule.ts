import { ethers } from "ethers";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { IBlockStorageModule } from "./interfaces/IBlockStorageModule";
import { BlockHash } from "@/types/storage";

export class BlockStorageModule implements IBlockStorageModule {
    //BlockConfirmationStruct => SignedBlockStruct => encodedBlock => BlockStruct
    private blockConfirmationStructsMap: Map<
        BlockHash,
        BlockConfirmationStruct
    >;
    private latestBlockConfirmationKey: BlockHash;

    constructor() {
        this.blockConfirmationStructsMap = new Map();
        this.latestBlockConfirmationKey = "0";
    }

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined {
        // TODO
        return ethers.ZeroHash;
    }

    getLatestBlock(): SignedBlockStruct {
        return this.getLatestBlockConfirmation().signedBlock;
    }

    getLatestBlockConfirmation(): BlockConfirmationStruct {
        const confirmation = this.blockConfirmationStructsMap.get(
            this.latestBlockConfirmationKey
        );
        if (!confirmation) {
            throw new Error("No latest block confirmation found");
        }
        return confirmation;
    }
}
