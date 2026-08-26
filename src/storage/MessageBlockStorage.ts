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

export type MessageBlockRun = {
    // the part of the range storage can prove, oldest first
    blocks: MessageBlockStruct[];
    // the first hash the walk needed and we do not hold
    missingBlockHash?: Hash;
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
        return this.blockMap.get(blockHash);
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
        return this.blockMap.get(this.latestBlockHash);
    }

    getLatestBlockHash(): Hash | undefined {
        return this.latestBlockHash;
    }

    getLatestBlockHeight(): BlockHeight | undefined {
        return this.latestBlockHeight;
    }

    // newest first, and truncated at a gap rather than throwing - "the latest
    // N blocks" is exactly what a truncated walk returns
    getLatestMessageBlocks(limit?: number): MessageBlockStruct[] {
        if (!this.latestBlockHash) return [];

        return this.walkBack({
            upperBlockHash: this.latestBlockHash,
            limit
        }).newestFirst;
    }

    // newest-first walk over [upperBlockHash, lowerBlockHash), stopping at the
    // first hash we do not hold -> no caller walks into a gap by accident
    private walkBack(options?: GetRangeOptions & { limit?: number }): {
        newestFirst: MessageBlockStruct[];
        missingBlockHash?: Hash;
    } {
        const { upperBlockHash, lowerBlockHash, limit } = options ?? {};
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
            const messageBlock = this.blockMap.get(currentHash);
            if (!messageBlock)
                return { newestFirst, missingBlockHash: currentHash };
            newestFirst.push(messageBlock);
            if (limit !== undefined && newestFirst.length >= limit) break;
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
