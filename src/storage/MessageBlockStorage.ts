import {
    PersistentCollection,
    type CollectionId,
    type PersistenceController
} from "./persistence";
import type { PersistedMessageBlockRecord } from "./persistence/storageCodecs";
import { BlockHeight, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ZeroHash } from "ethers";

type StoreOptions = {
    hash?: Hash;
    justPersist?: boolean; // if true, do not update latest block pointers
};

type GetRangeOptions = {
    upperBlockHash?: Hash; // newer/higher block (start of backwards traversal, inclusive)
    lowerBlockHash?: Hash; // older/lower block (stop of backwards traversal, exclusive)
};

export type MessageBlockRun = {
    // the part of the range storage can prove, oldest first
    blocks: MessageBlockStruct[];
    // the first hash the walk needed and we do not hold
    missingBlockHash?: Hash;
};

export class MessageBlockStorage {
    private readonly blockMap: PersistentCollection<
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
        this.blockMap = new PersistentCollection(collectionId, controller, () =>
            this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE / UPDATE
    // ====================================

    store(messageBlock: MessageBlockStruct, options?: StoreOptions): Hash {
        const blockHash =
            options?.hash ??
            hash(Codec.encode(messageBlock, Type.MessageBlock));

        this.normalizeBlockHeight(messageBlock.blockHeight);
        // a later store of a held hash keeps its first content
        this.blockMap.update(blockHash, (record) => {
            return {
                block: record?.block ?? messageBlock,
                advancesTip:
                    (record?.advancesTip ?? false) || !options?.justPersist
            };
        });
        return blockHash;
    }

    // a chain-verified run, ordered ascending. the pointers only move when the
    // run extends the current head exactly - a merely-held previousBlockHash
    // can itself sit above a gap, and the strict range read throws walking into one
    storeVerifiedRun(
        messageBlocks: MessageBlockStruct[],
        previousBlockHash: Hash
    ): void {
        const extendsHead =
            this.latestBlockHash === undefined
                ? previousBlockHash === ZeroHash
                : previousBlockHash === this.latestBlockHash;

        for (const messageBlock of messageBlocks) {
            this.store(messageBlock, { justPersist: !extendsHead });
        }
    }

    // ====================================
    // READ
    // ====================================

    // the local head, or the snapshot's own head while the store still lags it
    // -> callers never walk from a point below the snapshot they work against
    headNotBehind(
        snapshotHash: Hash,
        snapshotHeight: BlockHeight
    ): { hash: Hash; height: BlockHeight } {
        const height = this.latestBlockHeight ?? 0;
        if (this.latestBlockHash === undefined || height < snapshotHeight) {
            return { hash: snapshotHash, height: snapshotHeight };
        }
        return { hash: this.latestBlockHash, height };
    }

    getMessageBlock(blockHash: Hash): MessageBlockStruct | undefined {
        return this.blockMap.get(blockHash)?.block;
    }

    // [upperBlockHash, lowerBlockHash) - oldest first, truncated at the first
    // hash we do not hold
    tryGetMessageBlocksInRange(options?: GetRangeOptions): MessageBlockRun {
        const { newestFirst, missingBlockHash } = this.walkBack(options);
        return { blocks: newestFirst.reverse(), missingBlockHash };
    }

    getMessageBlocksInRange(options?: GetRangeOptions): MessageBlockStruct[] {
        const { blocks, missingBlockHash } =
            this.tryGetMessageBlocksInRange(options);
        if (missingBlockHash)
            throw new Error(
                `Block hash ${missingBlockHash} not found in storage`
            );
        return blocks;
    }

    getLatestMessageBlock(): MessageBlockStruct | undefined {
        if (!this.latestBlockHash) return undefined;
        return this.blockMap.get(this.latestBlockHash)?.block;
    }

    getLatestBlockHash(): Hash | undefined {
        return this.latestBlockHash;
    }

    getLatestBlockHeight(): BlockHeight | undefined {
        return this.latestBlockHeight;
    }

    rebuildIndexes(): void {
        this.latestBlockHash = undefined;
        this.latestBlockHeight = undefined;
        for (const [hashValue, record] of this.blockMap.entries()) {
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

    // newest-first walk over [upperBlockHash, lowerBlockHash), stopping at the
    // first hash we do not hold -> no caller walks into a gap by accident
    private walkBack(options?: GetRangeOptions): {
        newestFirst: MessageBlockStruct[];
        missingBlockHash?: Hash;
    } {
        const { upperBlockHash, lowerBlockHash } = options ?? {};
        const newestFirst: MessageBlockStruct[] = [];
        const startBlockHash = upperBlockHash ?? this.latestBlockHash;
        if (!startBlockHash) return { newestFirst };
        if (startBlockHash == ZeroHash) {
            return lowerBlockHash && lowerBlockHash != ZeroHash
                ? { newestFirst, missingBlockHash: lowerBlockHash }
                : { newestFirst };
        }

        let currentHash = startBlockHash;
        while (currentHash != ZeroHash) {
            if (lowerBlockHash && currentHash === lowerBlockHash) break;
            const messageBlock = this.blockMap.get(currentHash)?.block;
            if (!messageBlock)
                return { newestFirst, missingBlockHash: currentHash };
            newestFirst.push(messageBlock);
            currentHash = messageBlock.previousBlockHash as Hash;
        }
        if (
            lowerBlockHash &&
            lowerBlockHash != ZeroHash &&
            currentHash != lowerBlockHash
        ) {
            return { newestFirst, missingBlockHash: lowerBlockHash };
        }
        return { newestFirst };
    }

    private normalizeBlockHeight(
        height: MessageBlockStruct["blockHeight"]
    ): BlockHeight {
        if (height === undefined || height === null)
            throw new Error("MessageBlockStorage - Block height is undefined");
        return Number(height);
    }
}
