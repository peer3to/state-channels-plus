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

    /** Removes the retained block with `blockHash` (it became history); false when none is retained. */
    deleteBlock(blockHash: Hash): boolean {
        const block = this.blocksByHash.get(blockHash);
        if (!block) return false;
        this.blocksByHash.delete(blockHash);
        const key = coordinateKey(block.forkId, block.height);
        const hashes = this.hashesByCoordinate.get(key)!;
        hashes.delete(blockHash);
        if (hashes.size === 0) this.hashesByCoordinate.delete(key);
        return true;
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
     * The retained blocks at the coordinate, most distinct `rankSigners`
     * first; a tie takes the lowest block hash first.
     */
    rankBlocksAt(
        forkId: ForkId,
        height: BlockHeight,
        rankSigners: ReadonlySet<Address>
    ): Block[] {
        return this.rank(this.getBlocks(forkId, height), rankSigners);
    }

    /**
     * The retained blocks that link to `previous` at the next height, most
     * distinct `rankSigners` first; a tie takes the lowest block hash first.
     */
    rankLinkedChildren(
        previous: Block,
        rankSigners: ReadonlySet<Address>
    ): Block[] {
        return this.rank(
            this.getBlocks(previous.forkId, previous.height + 1).filter(
                (block) => block.previousBlockHash === previous.hash
            ),
            rankSigners
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
     * Orders by distinct contract-accepted signers in `rankSigners`, so
     * signatures by outsiders or repeated signatures by one key add nothing;
     * the lowest block hash first on a tie.
     */
    private rank(blocks: Block[], rankSigners: ReadonlySet<Address>): Block[] {
        const counted = blocks.map((block) => {
            let count = 0;
            for (const signer of block.acceptedSignerAddresses)
                if (rankSigners.has(signer)) count++;
            return { block, count, hash: String(block.hash) };
        });
        counted.sort((a, b) =>
            b.count !== a.count
                ? b.count - a.count
                : a.hash < b.hash
                  ? -1
                  : a.hash > b.hash
                    ? 1
                    : 0
        );
        return counted.map(({ block }) => block);
    }
}
