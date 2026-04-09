import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { BlockHeight, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { ZeroHash } from "ethers";

type StoreOptions = {
    hash?: Hash;
    justPersist?: boolean; // if true, do not update latest block pointers
};

type GetRangeOptions = {
    upperBlockHash?: Hash; // newer/higher block (start of backwards traversal, inclusive)
    lowerBlockHash?: Hash; // older/lower block (stop of backwards traversal, exclusive)
};

export class MessageBlockStorage {
    private blockMap: Map<Hash, MessageBlockStruct>;
    private latestBlockHash?: Hash;
    private latestBlockHeight?: BlockHeight;

    constructor() {
        this.blockMap = new Map();
    }

    // ====================================
    // CREATE / UPDATE
    // ====================================

    store(messageBlock: MessageBlockStruct, options?: StoreOptions): Hash {
        const blockHash =
            options?.hash ??
            hash(Codec.encode(messageBlock, Type.MessageBlock));

        const blockHeight = this.normalizeBlockHeight(messageBlock.blockHeight);

        if (!this.blockMap.has(blockHash)) {
            this.blockMap.set(blockHash, messageBlock);
        }

        if (options?.justPersist) return blockHash;

        if (
            this.latestBlockHeight === undefined ||
            blockHeight >= this.latestBlockHeight
        ) {
            this.latestBlockHeight = blockHeight;
            this.latestBlockHash = blockHash;
        }
        return blockHash;
    }

    // ====================================
    // READ
    // ====================================

    getMessageBlock(blockHash: Hash): MessageBlockStruct | undefined {
        return this.blockMap.get(blockHash);
    }

    // [upperBlockHash, lowerBlockHash) - iterate backwards the blockchain
    *getIterator(
        options?: GetRangeOptions
    ): Generator<MessageBlockStruct, void, unknown> {
        const { upperBlockHash, lowerBlockHash } = options ?? {};
        const startBlockHash = upperBlockHash ?? this.latestBlockHash;
        if (!startBlockHash || startBlockHash == ZeroHash) return;

        let currentHash = startBlockHash;
        while (currentHash != ZeroHash) {
            if (lowerBlockHash && currentHash === lowerBlockHash) break;
            const messageBlock = this.blockMap.get(currentHash);
            if (!messageBlock)
                throw new Error(
                    `Block hash ${currentHash} not found in storage`
                );
            yield messageBlock;
            currentHash = messageBlock.previousBlockHash as Hash;
        }
    }

    getMessageBlocksInRange(options?: GetRangeOptions): MessageBlockStruct[] {
        const blocks: MessageBlockStruct[] = [];
        for (const messageBlock of this.getIterator(options)) {
            blocks.unshift(messageBlock);
        }
        return blocks;
    }

    getLatestMessageBlock(): MessageBlockStruct | undefined {
        if (!this.latestBlockHash) return undefined;
        return this.blockMap.get(this.latestBlockHash);
    }

    getLatestBlockHash(): Hash | undefined {
        return this.latestBlockHash;
    }

    getLatestBlockHeight(): BlockHeight | undefined {
        return this.latestBlockHeight;
    }

    getLatestMessageBlocks(limit?: number): MessageBlockStruct[] {
        if (!this.latestBlockHash) return [];

        const blocks: MessageBlockStruct[] = [];
        for (const messageBlock of this.getIterator({
            upperBlockHash: this.latestBlockHash
        })) {
            blocks.push(messageBlock);
            if (limit !== undefined && blocks.length >= limit) break;
        }
        return blocks;
    }

    private normalizeBlockHeight(
        height: MessageBlockStruct["blockHeight"]
    ): BlockHeight {
        if (height === undefined || height === null)
            throw new Error("MessageBlockStorage - Block height is undefined");
        return Number(height);
    }
}
