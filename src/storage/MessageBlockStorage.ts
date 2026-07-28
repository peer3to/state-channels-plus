import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ZeroHash } from "ethers";

import type { BlockHeight, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";

import {
    PersistentCollection,
    type CollectionId,
    type PersistenceController
} from "./persistence";
import type { PersistedMessageBlockRecord } from "./persistence/storageCodecs";

type StoreOptions = {
    hash?: Hash;
    justPersist?: boolean;
};

type GetRangeOptions = {
    upperBlockHash?: Hash;
    lowerBlockHash?: Hash;
};

export class MessageBlockStorage {
    private readonly records: PersistentCollection<
        Hash,
        PersistedMessageBlockRecord
    >;
    private latestBlockHash?: Hash;
    private latestBlockHeight?: BlockHeight;

    constructor(
        collectionId: Extract<
            CollectionId,
            "inboundMessages" | "outboundMessages"
        > = "inboundMessages",
        controller?: PersistenceController
    ) {
        this.records = new PersistentCollection(collectionId, controller, () =>
            this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE / UPDATE
    // ====================================

    public store(
        messageBlock: MessageBlockStruct,
        options?: StoreOptions
    ): Hash {
        const blockHash =
            options?.hash ??
            hash(Codec.encode(messageBlock, Type.MessageBlock));
        this.normalizeBlockHeight(messageBlock.blockHeight);
        this.records.update(blockHash, (record) => {
            if (
                record &&
                Codec.encode(record.block, Type.MessageBlock) !==
                    Codec.encode(messageBlock, Type.MessageBlock)
            ) {
                throw new Error(
                    `Incompatible message block for hash ${blockHash}`
                );
            }
            return {
                block: record?.block ?? messageBlock,
                advancesTip:
                    (record?.advancesTip ?? false) || !options?.justPersist
            };
        });
        return blockHash;
    }

    // ====================================
    // READ
    // ====================================

    public getMessageBlock(blockHash: Hash): MessageBlockStruct | undefined {
        return this.records.get(blockHash)?.block;
    }

    // [upperBlockHash, lowerBlockHash) - iterate backwards the blockchain
    public *getIterator(
        options?: GetRangeOptions
    ): Generator<MessageBlockStruct, void, unknown> {
        const { upperBlockHash, lowerBlockHash } = options ?? {};
        const startBlockHash = upperBlockHash ?? this.latestBlockHash;
        if (!startBlockHash || startBlockHash === ZeroHash) return;

        let currentHash = startBlockHash;
        while (currentHash !== ZeroHash) {
            if (lowerBlockHash && currentHash === lowerBlockHash) break;
            const messageBlock = this.records.get(currentHash)?.block;
            if (!messageBlock) {
                throw new Error(
                    `Block hash ${currentHash} not found in storage`
                );
            }
            yield messageBlock;
            currentHash = messageBlock.previousBlockHash as Hash;
        }
    }

    public getMessageBlocksInRange(
        options?: GetRangeOptions
    ): MessageBlockStruct[] {
        const blocks: MessageBlockStruct[] = [];
        for (const messageBlock of this.getIterator(options)) {
            blocks.unshift(messageBlock);
        }
        return blocks;
    }

    public getLatestMessageBlock(): MessageBlockStruct | undefined {
        return this.latestBlockHash
            ? this.records.get(this.latestBlockHash)?.block
            : undefined;
    }

    public getLatestBlockHash(): Hash | undefined {
        return this.latestBlockHash;
    }

    public getLatestBlockHeight(): BlockHeight | undefined {
        return this.latestBlockHeight;
    }

    public getLatestMessageBlocks(limit?: number): MessageBlockStruct[] {
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

    public rebuildIndexes(): void {
        this.latestBlockHash = undefined;
        this.latestBlockHeight = undefined;
        for (const [hashValue, record] of this.records.entries()) {
            if (!record.advancesTip) continue;
            const height = this.normalizeBlockHeight(record.block.blockHeight);
            if (
                this.latestBlockHeight === undefined ||
                height >= this.latestBlockHeight
            ) {
                this.latestBlockHeight = height;
                this.latestBlockHash = hashValue;
            }
        }
    }

    private normalizeBlockHeight(
        height: MessageBlockStruct["blockHeight"]
    ): BlockHeight {
        if (height === undefined || height === null) {
            throw new Error("MessageBlockStorage - Block height is undefined");
        }
        return Number(height);
    }
}
