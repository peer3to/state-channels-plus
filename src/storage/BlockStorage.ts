import { ethers } from "ethers";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { IBlockStorageModule } from "./interfaces/IBlockStorage";
import { BlockHash, ForkHeight } from "@/types/storage";
import { Codec, Type } from "@/utils";

export class BlockStorageModule implements IBlockStorageModule {
    //BlockConfirmationStruct => SignedBlockStruct => encodedBlock => BlockStruct
    private blockhashToBlockConfirmationStructsMap: Map<
        BlockHash,
        BlockConfirmationStruct
    >;
    private forkHeightToBlockConfirmationStructsMap: Map<
        ForkHeight,
        BlockConfirmationStruct
    >;

    constructor() {
        this.blockhashToBlockConfirmationStructsMap = new Map();
        this.forkHeightToBlockConfirmationStructsMap = new Map();
    }

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
    insertBlock(
        blockData: SignedBlockStruct | BlockConfirmationStruct,
        blockHash?: BlockHash,
        fork?: number,
        height?: number
    ): void {
        if (this.isBlockConfirmation(blockData)) {
            if (blockHash) {
                this.insertBlockConfirmationWithHash(blockData, blockHash);
            } else if (fork && height) {
                this.insertBlockConfirmationWithForkAndHeight(
                    blockData,
                    fork,
                    height
                );
            }
        } else {
            if (blockHash) {
                this.insertSignedBlockWithHash(blockData, blockHash);
            } else if (fork && height) {
                this.insertSignedBlockWithForkAndHeight(
                    blockData,
                    fork,
                    height
                );
            }
        }
    }

    getBlockConfirmation(
        blockHash: BlockHash
    ): BlockConfirmationStruct | undefined;
    getBlockConfirmation(
        fork: number,
        height: number
    ): BlockConfirmationStruct | undefined;
    getBlockConfirmation(
        blockHashOrFork?: BlockHash | number,
        height?: number
    ): BlockConfirmationStruct | undefined {
        if (typeof blockHashOrFork === "string") {
            // Called with blockHash
            return this.blockhashToBlockConfirmationStructsMap.get(
                blockHashOrFork
            );
        } else if (
            typeof blockHashOrFork === "number" &&
            typeof height === "number"
        ) {
            // Called with fork and height
            const forkHeight: ForkHeight = [blockHashOrFork, height];
            return this.forkHeightToBlockConfirmationStructsMap.get(forkHeight);
        }
        return undefined;
    }
    deleteBlockConfirmation(blockHash: BlockHash): void;
    deleteBlockConfirmation(fork: number, height: number): void;
    deleteBlockConfirmation(
        blockHashOrFork?: BlockHash | number,
        height?: number
    ): void {
        if (typeof blockHashOrFork === "string") {
            // Called with blockHash
            this.blockhashToBlockConfirmationStructsMap.delete(blockHashOrFork);
        } else if (
            typeof blockHashOrFork === "number" &&
            typeof height === "number"
        ) {
            // Called with fork and height
            const forkHeight: ForkHeight = [blockHashOrFork, height];
            this.forkHeightToBlockConfirmationStructsMap.delete(forkHeight);
        }
    }

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined {
        const blockConfirmation = this.getBlockConfirmation(
            forkCnt,
            transactionCnt
        );
        if (blockConfirmation) {
            const block = Codec.decode(
                blockConfirmation.signedBlock.encodedBlock,
                Type.Block
            );
            return block.previousBlockHash as BlockHash;
        }
        return undefined;
    }

    private insertSignedBlockWithHash(
        signedBlock: SignedBlockStruct,
        blockHash: BlockHash
    ): void {
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };
        this.insertBlockConfirmationWithHash(blockConfirmation, blockHash);
    }
    private insertSignedBlockWithForkAndHeight(
        signedBlock: SignedBlockStruct,
        fork: number,
        height: number
    ): void {
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };
        this.insertBlockConfirmationWithForkAndHeight(
            blockConfirmation,
            fork,
            height
        );
    }
    private insertBlockConfirmationWithHash(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: BlockHash
    ): void {
        this.blockhashToBlockConfirmationStructsMap.set(
            blockHash,
            blockConfirmation
        );
    }
    private insertBlockConfirmationWithForkAndHeight(
        blockConfirmation: BlockConfirmationStruct,
        fork: number,
        height: number
    ): void {
        const forkHeight: ForkHeight = [fork, height];
        this.forkHeightToBlockConfirmationStructsMap.set(
            forkHeight,
            blockConfirmation
        );
    }
    private isBlockConfirmation(
        blockData: SignedBlockStruct | BlockConfirmationStruct
    ): blockData is BlockConfirmationStruct {
        return "signedBlock" in blockData && "signatures" in blockData;
    }
}
