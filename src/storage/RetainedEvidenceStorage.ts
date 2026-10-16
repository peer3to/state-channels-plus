import { coordinateKey, CoordinateKey } from "./keys";
import { Block } from "@/models";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";

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

    /**
     * The retained block at the coordinate signed by the most distinct
     * `eligibleSigners`; a tie takes the lowest block hash.
     */
    getMostSignedBlock(
        forkId: ForkId,
        height: BlockHeight,
        eligibleSigners: ReadonlySet<Address>
    ): Block | undefined {
        return this.mostSigned(this.getBlocks(forkId, height), eligibleSigners);
    }

    /**
     * The retained block that links to `previous` at the next height; with
     * several, the one signed by the most distinct `eligibleSigners`, a tie
     * taking the lowest block hash.
     */
    getLinkedChild(
        previous: Block,
        eligibleSigners: ReadonlySet<Address>
    ): Block | undefined {
        return this.mostSigned(
            this.getBlocks(previous.forkId, previous.height + 1).filter(
                (block) => block.previousBlockHash === previous.hash
            ),
            eligibleSigners
        );
    }

    /**
     * A retained block at the coordinate by `author` with another identity
     * than `blockHash`: a double sign. Takes scalars, so a lookup copies no
     * block.
     */
    getOtherBlockByAuthor(
        forkId: ForkId,
        height: BlockHeight,
        author: Address,
        blockHash: Hash
    ): Block | undefined {
        return this.getBlocks(forkId, height).find(
            (retained) =>
                retained.author === author && retained.hash !== blockHash
        );
    }

    /**
     * Ranks by distinct contract-accepted signers in `eligibleSigners`, so
     * signatures by outsiders or repeated signatures by one key add nothing.
     */
    private mostSigned(
        blocks: Block[],
        eligibleSigners: ReadonlySet<Address>
    ): Block | undefined {
        let chosen: Block | undefined;
        let chosenCount = -1;
        for (const block of blocks) {
            let count = 0;
            for (const signer of block.acceptedSignerAddresses)
                if (eligibleSigners.has(signer)) count++;
            if (
                count > chosenCount ||
                (count === chosenCount && block.hash < chosen!.hash)
            ) {
                chosen = block;
                chosenCount = count;
            }
        }
        return chosen;
    }
}
