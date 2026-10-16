import { coordinateKey, CoordinateKey } from "./keys";
import { Block } from "@/models";
import { BlockHeight, ForkId, Hash } from "@/types/types";

/**
 * Verified proof blocks that are not final history: support a state-proof
 * walk checked but did not prove final. Several identities can share one
 * height. This is evidence only: it never occupies the block history, never
 * moves a view, and its readers choose what it may show.
 */
export class RetainedEvidenceStorage {
    private blocksByHash: Map<Hash, Block>;
    // the hashes of the retained blocks at one coordinate
    private hashesByCoordinate: Map<CoordinateKey, Set<Hash>>;

    constructor() {
        this.blocksByHash = new Map();
        this.hashesByCoordinate = new Map();
    }

    /** Retains `block`; a copy already held gains its signatures. */
    storeBlock(block: Block): Hash {
        const blockHash = block.hash;
        const existing = this.blocksByHash.get(blockHash);
        if (existing) {
            existing.mergeFrom(block);
            return blockHash;
        }
        this.blocksByHash.set(blockHash, block);
        const key = coordinateKey(block.forkId, block.height);
        const hashes = this.hashesByCoordinate.get(key) ?? new Set<Hash>();
        hashes.add(blockHash);
        this.hashesByCoordinate.set(key, hashes);
        return blockHash;
    }

    getBlock(blockHash: Hash): Block | undefined {
        return this.blocksByHash.get(blockHash);
    }

    /** Every retained identity at the coordinate. */
    getBlocks(forkId: ForkId, height: BlockHeight): Block[] {
        const hashes = this.hashesByCoordinate.get(
            coordinateKey(forkId, height)
        );
        return [...(hashes ?? [])].map((hash) => this.blocksByHash.get(hash)!);
    }

    /** The retained block at the coordinate carrying the most signatures. */
    getMostSignedBlock(forkId: ForkId, height: BlockHeight): Block | undefined {
        return this.mostSigned(this.getBlocks(forkId, height));
    }

    /**
     * The retained block that links to `previous` at the next height; with
     * several, the one carrying the most signatures.
     */
    getLinkedChild(previous: Block): Block | undefined {
        return this.mostSigned(
            this.getBlocks(previous.forkId, previous.height + 1).filter(
                (block) => block.previousBlockHash === previous.hash
            )
        );
    }

    /** A retained block at `block`'s coordinate by the same author with another identity: a double sign. */
    getOtherBlockByAuthor(block: Block): Block | undefined {
        return this.getBlocks(block.forkId, block.height).find(
            (retained) =>
                retained.author === block.author && retained.hash !== block.hash
        );
    }

    private mostSigned(blocks: Block[]): Block | undefined {
        let chosen: Block | undefined;
        for (const block of blocks)
            if (!chosen || block.allSignatures.size > chosen.allSignatures.size)
                chosen = block;
        return chosen;
    }
}
