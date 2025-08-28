import { Block } from "@/models";
import { Hash, ForkId, BlockHeight } from "@/types/types";

export class QueueStorage {
    private queuedBlocks: Map<Hash, Block> = new Map();

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<string, Set<Hash>> = new Map();

    /** Queue a block for future processing */
    queueBlock(block: Block): Hash {
        // Check if block already exists in queue
        const existingBlock = this.queuedBlocks.get(block.hash);

        if (existingBlock) {
            // Merge signatures from the new confirmation

            const mergedSignaturesBlock = existingBlock.expandSignatures(
                block.confirmationSignatures
            );
            this.queuedBlocks.set(block.hash, mergedSignaturesBlock);
            return block.hash;
        }
        // Store the new block confirmation
        this.queuedBlocks.set(block.hash, block);
        this.addHashToCoordinateIndex(block.hash, block.forkId, block.height);

        return block.hash;
    }

    /** Try to dequeue confirmations for a specific fork/height */
    tryDequeue(forkId: ForkId, height: BlockHeight): Block[] {
        const coordinateKey = this.coordinatesToKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(coordinateKey);

        if (!hashSet) {
            return [];
        }

        const blocks: Block[] = [];

        // Collect all blocks for this coordinate
        for (const hash of hashSet) {
            const blockConfirmation = this.queuedBlocks.get(hash);
            if (blockConfirmation) {
                blocks.push(blockConfirmation);

                // delete the block from the queue
                this.queuedBlocks.delete(hash);
            }
        }

        // Remove from queue
        this.blocksByCoordinates.delete(coordinateKey);

        return blocks;
    }

    isBlockQueued(block: Block, options?: { hash?: Hash }): boolean {
        const blockHash = options?.hash || block.hash;

        if (!this.queuedBlocks.has(blockHash)) {
            return false;
        }

        const existingBlockConfirmation = this.queuedBlocks.get(blockHash);
        if (existingBlockConfirmation) {
            existingBlockConfirmation.expandSignatures(
                block.confirmationSignatures
            );
            this.queuedBlocks.set(blockHash, existingBlockConfirmation);
        }

        return true;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private coordinatesToKey(forkId: ForkId, height: BlockHeight): string {
        return `${forkId}:${height}`;
    }

    private addHashToCoordinateIndex(
        hash: Hash,
        forkId: ForkId,
        height: BlockHeight
    ): void {
        const coordinateKey = this.coordinatesToKey(forkId, height);

        if (!this.blocksByCoordinates.has(coordinateKey)) {
            this.blocksByCoordinates.set(coordinateKey, new Set());
        }
        this.blocksByCoordinates.get(coordinateKey)!.add(hash);
    }
}
