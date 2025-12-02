import { ethers } from "ethers";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import { BlockHeight, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
export interface MessageBlockEntry {
    messageBlock: MessageBlockStruct;
}

type StoreOptions = {
    hash?: Hash;
};

export class MessageBlockStorage {
    private blockMap: Map<Hash, MessageBlockEntry>;
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
            this.blockMap.set(hash, { messageBlock });
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
        return this.blockMap.get(blockHash)?.messageBlock;
    }

    getEntry(blockHash: Hash): MessageBlockEntry | undefined {
        return this.blockMap.get(blockHash);
    }

    // [fromBlockHash, toBlockHash) - iterate backwards the blockchain
    *getIterator(
        fromBlockHash: Hash,
        toBlockHash?: Hash
    ): Generator<MessageBlockEntry, void, unknown> {
        if (fromBlockHash == ethers.ZeroHash) return;
        let currentHash = fromBlockHash;
        while (currentHash != ethers.ZeroHash) {
            if (toBlockHash && currentHash === toBlockHash) break;
            const entry = this.blockMap.get(currentHash);
            if (!entry)
                throw new Error(
                    `Block hash ${currentHash} not found in storage`
                );
            yield entry;
            currentHash = entry.messageBlock.previousBlockHash as Hash;
        }
    }

    getMessageBlocksInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): MessageBlockStruct[] {
        const blocks: MessageBlockStruct[] = [];
        for (const entry of this.getIterator(fromBlockHash, toBlockHash)) {
            blocks.unshift(entry.messageBlock);
        }
        return blocks;
    }

    getEntriesInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): MessageBlockEntry[] {
        const entries: MessageBlockEntry[] = [];
        for (const entry of this.getIterator(fromBlockHash, toBlockHash)) {
            entries.unshift(entry);
        }
        return entries;
    }

    getLatestEntry(): MessageBlockEntry | undefined {
        if (!this.latestBlockHash) return undefined;
        return this.blockMap.get(this.latestBlockHash);
    }

    getLatestMessageBlock(): MessageBlockStruct | undefined {
        return this.getLatestEntry()?.messageBlock;
    }

    getLatestBlockHash(): Hash | undefined {
        return this.latestBlockHash;
    }

    getLatestBlockHeight(): BlockHeight | undefined {
        return this.latestBlockHeight;
    }

    getLatestEntries(limit?: number): MessageBlockEntry[] {
        if (!this.latestBlockHash) return [];

        const entries: MessageBlockEntry[] = [];
        for (const entry of this.getIterator(this.latestBlockHash)) {
            entries.push(entry);
            if (limit !== undefined && entries.length >= limit) break;
        }
        return entries;
    }

    getLatestMessageBlocks(limit?: number): MessageBlockStruct[] {
        return this.getLatestEntries(limit).map((entry) => entry.messageBlock);
    }

    private normalizeBlockHeight(
        height: MessageBlockStruct["blockHeight"]
    ): BlockHeight {
        if (height === undefined || height === null) return 0;
        return Number(height);
    }
}
