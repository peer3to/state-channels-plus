import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Block } from "@/models";
import { Hash, ForkId, BlockHeight } from "@/types/types";
import { hash } from "@/utils";

export class QueueStorage {
    private queuedBlocks: Map<Hash, BlockConfirmationStruct> = new Map();

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<string, Set<Hash>> = new Map();

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

    /** Queue a block confirmation for future processing */
    queueConfirmation(blockConfirmation: BlockConfirmationStruct): Hash {
        const block = Block.decode(blockConfirmation.signedBlock.encodedBlock);

        // Check if block already exists in queue
        const existingBlockConfirmation = this.queuedBlocks.get(block.hash);

        if (existingBlockConfirmation) {
            // Merge signatures from the new confirmation
            const updatedBlockConfirmation = this.expandSignatures(
                existingBlockConfirmation,
                blockConfirmation.signatures
            );
            this.queuedBlocks.set(block.hash, updatedBlockConfirmation);
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

        const blockConfirmations: BlockConfirmationStruct[] = [];

        // Collect all blocks for this coordinate
        for (const hash of hashSet) {
            const blockConfirmation = this.queuedBlocks.get(hash);
            if (blockConfirmation) {
                blockConfirmations.push(blockConfirmation);

                // delete the block from the queue
                this.queuedBlocks.delete(hash);
            }
        }

        // Remove from queue
        this.blocksByCoordinates.delete(coordinateKey);

        return blockConfirmations;
    }

    isBlockQueued(
        blockConfirmation: BlockConfirmationStruct,
        options?: { hash?: Hash }
    ): boolean {
        const blockHash =
            options?.hash || hash(blockConfirmation.signedBlock.encodedBlock);

        if (!this.queuedBlocks.has(blockHash)) {
            return false;
        }

        const existingBlockConfirmation = this.queuedBlocks.get(blockHash);
        if (existingBlockConfirmation) {
            const updatedBlockConfirmation = this.expandSignatures(
                existingBlockConfirmation,
                blockConfirmation.signatures
            );
            this.queuedBlocks.set(blockHash, updatedBlockConfirmation);
        }

        return true;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private expandSignatures(
        existingBlockConfirmation: BlockConfirmationStruct,
        newSignatures: any[]
    ): BlockConfirmationStruct {
        const signaturesSet = new Set(existingBlockConfirmation.signatures);
        for (const newSignature of newSignatures) {
            signaturesSet.add(newSignature);
        }

        return {
            ...existingBlockConfirmation,
            signatures: Array.from(signaturesSet)
        };
    }

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
