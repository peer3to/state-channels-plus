import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Block } from "@/models";
import { Hash, ForkId, BlockHeight } from "@/types/types";

export class QueueStorage {
    private queuedBlocks: Map<Hash, BlockConfirmationStruct> = new Map();

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<string, Set<Hash>> = new Map();

    // ====================================
    // BLOCK QUEUE OPERATIONS
    // ====================================

    /** Queue a block for future processing */
    queueBlock(signedBlock: SignedBlockStruct): Hash {
        const block = Block.decode(signedBlock.encodedBlock);

        // Convert to BlockConfirmationStruct with empty signatures
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: []
        };

        this.queuedBlocks.set(block.hash, blockConfirmation);

        // Update coordinate index
        this.addHashToCoordinateIndex(block.hash, block.forkId, block.height);

        return block.hash;
    }

    /** Try to dequeue blocks for a specific fork/height */
    tryDequeueBlocks(forkId: ForkId, height: BlockHeight): SignedBlockStruct[] {
        const coordinateKey = this.coordinatesToKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(coordinateKey);

        if (!hashSet) {
            return [];
        }

        const blocks: SignedBlockStruct[] = [];

        // Collect all blocks for this coordinate
        for (const hash of hashSet) {
            const blockConfirmation = this.queuedBlocks.get(hash);
            if (blockConfirmation) {
                blocks.push(blockConfirmation.signedBlock);

                // delete the block from the queue
                this.queuedBlocks.delete(hash);
            }
        }

        // Remove from queue
        this.blocksByCoordinates.delete(coordinateKey);

        return blocks;
    }

    isBlockQueued(hash: Hash): boolean {
        return this.queuedBlocks.has(hash);
    }

    // ====================================
    // CONFIRMATION QUEUE OPERATIONS
    // ====================================

    /** Queue a block confirmation for future processing */
    queueConfirmation(blockConfirmation: BlockConfirmationStruct): Hash {
        const block = Block.decode(blockConfirmation.signedBlock.encodedBlock);

        // Check if block already exists in queue
        const existingBlockConfirmation = this.queuedBlocks.get(block.hash);

        if (existingBlockConfirmation) {
            // Merge signatures from the new confirmation
            const signaturesSet = new Set(existingBlockConfirmation.signatures);
            for (const newSignature of blockConfirmation.signatures) {
                signaturesSet.add(newSignature);
            }

            this.queuedBlocks.set(block.hash, {
                signedBlock: existingBlockConfirmation.signedBlock,
                signatures: Array.from(signaturesSet)
            });
            return block.hash;
        }
        // Store the new block confirmation
        this.queuedBlocks.set(block.hash, blockConfirmation);
        this.addHashToCoordinateIndex(block.hash, block.forkId, block.height);

        return block.hash;
    }

    /** Try to dequeue confirmations for a specific fork/height */
    tryDequeueConfirmations(
        forkId: ForkId,
        height: BlockHeight
    ): BlockConfirmationStruct[] {
        const coordinateKey = this.coordinatesToKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(coordinateKey);

        if (!hashSet) {
            return [];
        }

        const confirmations: BlockConfirmationStruct[] = [];

        // Collect all confirmations for this coordinate
        for (const hash of hashSet) {
            const blockConfirmation = this.queuedBlocks.get(hash);
            if (blockConfirmation && blockConfirmation.signatures.length > 0) {
                confirmations.push(blockConfirmation);
                // Clear the signatures but keep the block
                blockConfirmation.signatures = [];
            }
        }

        return confirmations;
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
