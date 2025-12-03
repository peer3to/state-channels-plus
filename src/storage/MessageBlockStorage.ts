import { ethers } from "ethers";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import { BlockHeight, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

type StoreOptions = {
    hash?: Hash;
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
        const hash =
            options?.hash ??
            ethers.keccak256(Codec.encode(messageBlock, Type.MessageBlock));

        const blockHeight = this.normalizeBlockHeight(messageBlock.blockHeight);

        if (!this.blockMap.has(hash)) {
            this.blockMap.set(hash, messageBlock);
        }

        if (
            this.latestBlockHeight === undefined ||
            blockHeight >= this.latestBlockHeight
        ) {
            this.latestBlockHeight = blockHeight;
            this.latestBlockHash = hash;
        }
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    getMessageBlock(blockHash: Hash): MessageBlockStruct | undefined {
        return this.blockMap.get(blockHash);
    }

    // [fromBlockHash, toBlockHash) - iterate backwards the blockchain
    *getIterator(
        fromBlockHash: Hash,
        toBlockHash?: Hash
    ): Generator<MessageBlockStruct, void, unknown> {
        if (fromBlockHash == ethers.ZeroHash) return;
        let currentHash = fromBlockHash;
        while (currentHash != ethers.ZeroHash) {
            if (toBlockHash && currentHash === toBlockHash) break;
            const messageBlock = this.blockMap.get(currentHash);
            if (!messageBlock)
                throw new Error(
                    `Block hash ${currentHash} not found in storage`
                );
            yield messageBlock;
            currentHash = messageBlock.previousBlockHash as Hash;
        }
    }

    getMessageBlocksInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): MessageBlockStruct[] {
        const blocks: MessageBlockStruct[] = [];
        for (const messageBlock of this.getIterator(
            fromBlockHash,
            toBlockHash
        )) {
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
        for (const messageBlock of this.getIterator(this.latestBlockHash)) {
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
