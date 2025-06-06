import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockHash, ForkHeight } from "@/types/storage";
import { Codec, Type } from "@/utils";

export class BlockStorageModule {
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
            if (blockHash && fork && height) {
                this.insertBlockConfirmationWithKeys(
                    blockData,
                    blockHash,
                    fork,
                    height
                );
            } else {
                this.insertBlockConfirmation(blockData);
            }
        } else {
            if (blockHash && fork && height) {
                this.insertSignedBlockWithKeys(
                    blockData,
                    blockHash,
                    fork,
                    height
                );
            } else {
                this.insertSignedBlock(blockData);
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

    private insertSignedBlock(signedBlock: SignedBlockStruct): void {
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };
        this.insertBlockConfirmation(blockConfirmation);
    }
    private insertSignedBlockWithKeys(
        signedBlock: SignedBlockStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void {
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };
        this.insertBlockConfirmationWithKeys(
            blockConfirmation,
            blockHash,
            fork,
            height
        );
    }
    private insertBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): void {
        const blockHash = Codec.encode(
            blockConfirmation,
            Type.BlockConfirmation
        );
        const block = Codec.decode(
            blockConfirmation.signedBlock.encodedBlock,
            Type.Block
        );
        const fork = block.transaction.header.forkCnt;
        const height = block.transaction.header.transactionCnt;
        this.insertBlockConfirmationWithKeys(
            blockConfirmation,
            blockHash,
            Number(fork),
            Number(height)
        );
    }
    private insertBlockConfirmationWithKeys(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void {
        const forkHeight: ForkHeight = [fork, height];
        this.forkHeightToBlockConfirmationStructsMap.set(
            forkHeight,
            blockConfirmation
        );
        this.blockhashToBlockConfirmationStructsMap.set(
            blockHash,
            blockConfirmation
        );
    }
    private isBlockConfirmation(
        blockData: SignedBlockStruct | BlockConfirmationStruct
    ): blockData is BlockConfirmationStruct {
        return "signedBlock" in blockData && "signatures" in blockData;
    }
}
