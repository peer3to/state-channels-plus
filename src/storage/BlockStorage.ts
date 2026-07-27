import { Hash, ForkId, BlockHeight, Signature, Timestamp } from "@/types/types";
import { Block, BlockCoordinates } from "@/models";
import { DirtyKeyTracker } from "./persistence/DirtyKeyTracker";

type CoordinateKey = string;
type StoreOptions = {
    hash?: Hash;
    coordinates?: BlockCoordinates;
    justPersist?: boolean;
};

export enum SortOrder {
    ASC = "asc",
    DESC = "desc"
}

export class BlockStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private hashToBlockMap: Map<Hash, Block>;
    private coordinatesToBlockMap: Map<CoordinateKey, Block>;

    // NEW: Track highest height for each forkId
    private forkIdToMaxHeightMap: Map<ForkId, BlockHeight>;

    // Memory-only: hashes stored with { justPersist: true }. These live in the
    // read maps but are excluded from persistableEntries() so the durability
    // engine never diffs, persists or replays them (see storeBlock comment).
    private justPersistHashes: Set<Hash>;

    // Memory-only: hashes touched by a mutator since the last successful
    // flush (PO1 bounded diff), revisioned so a same-hash mutation racing an
    // in-flight commit survives to the next flush instead of being dropped
    // (RR1 - see DirtyKeyTracker). Peeked (not cleared) by the engine at diff
    // time; cleared only after a successful commit (see peekDirtyHashes).
    private dirtyHashes: DirtyKeyTracker<Hash>;

    // Memory-only: the hash a block object was actually STORED under
    // (options?.hash ?? block.hash at store time). A caller may override the
    // persisted key, so a mutator resolving a block by coordinates (or by an
    // object reference it already holds) must dirty/delete/track-justPersist
    // THIS key, never block's own intrinsic `hash` field - the two can
    // diverge, and using the wrong one silently drops the mutation from the
    // durable diff (FO4: its entry never existed under block.hash).
    private persistedHashByBlock: Map<Block, Hash>;

    constructor() {
        this.hashToBlockMap = new Map();
        this.coordinatesToBlockMap = new Map();
        this.forkIdToMaxHeightMap = new Map();
        this.justPersistHashes = new Set();
        this.dirtyHashes = new DirtyKeyTracker();
        this.persistedHashByBlock = new Map();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /**
     * The persistence engine's view of this store's PRIMARY map: every hash ->
     * block EXCEPT justPersist entries. Excluding them keeps justPersist
     * milestones out of the durable diff so they are never persisted or
     * replayed (see the justPersist comment in _storeBlockWithOptions).
     */
    *persistableEntries(): Iterable<[Hash, Block]> {
        for (const [hash, block] of this.hashToBlockMap) {
            if (!this.justPersistHashes.has(hash)) {
                yield [hash, block];
            }
        }
    }

    /** Single-key equivalent of persistableEntries() - same justPersist exclusion. */
    getPersistableEntry(hash: Hash): Block | undefined {
        if (this.justPersistHashes.has(hash)) return undefined;
        return this.hashToBlockMap.get(hash);
    }

    /** Peek (hash, revision) pairs touched since the last successful flush, without clearing. */
    peekDirtyHashes(): Iterable<readonly [Hash, number]> {
        return this.dirtyHashes.peek();
    }

    /** Clears exactly the peeked (hash, revision) pairs - called only after their diff committed. */
    clearDirtyHashes(entries: Iterable<readonly [Hash, number]>): void {
        this.dirtyHashes.clear(entries);
    }

    /**
     * Post-hydrate defense-in-depth check: every fork's heights from 0 up to
     * its recorded max must be present with no gap. PersistenceEngine.
     * hydrateAll() already fails closed on ANY record that fails to
     * decode/replay (FR2), so a gap from a corrupt record can no longer
     * reach this point - this remains as a second guard against a
     * structural gap from any other cause.
     */
    checkHeightContiguity(): Array<{
        forkId: ForkId;
        missingHeight: BlockHeight;
        maxHeight: BlockHeight;
    }> {
        const violations: Array<{
            forkId: ForkId;
            missingHeight: BlockHeight;
            maxHeight: BlockHeight;
        }> = [];
        for (const [forkId, maxHeight] of this.forkIdToMaxHeightMap) {
            for (let height = 0; height < maxHeight; height++) {
                const coordinateKey = this.coordinatesToKey({
                    forkId,
                    height
                });
                if (!this.coordinatesToBlockMap.has(coordinateKey)) {
                    violations.push({
                        forkId,
                        missingHeight: height,
                        maxHeight
                    });
                    break;
                }
            }
        }
        return violations;
    }

    // ====================================
    // CREATE
    // ====================================

    storeBlock(block: Block, options?: StoreOptions): Hash | undefined {
        return this._storeBlockWithOptions(block, options);
    }

    // ====================================
    // READ
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get block entry by hash */
    getBlock(blockHash: Hash): Block | undefined;

    /** [OVERLOAD 2] Get block entry by coordinates */
    getBlock(forkId: ForkId, height: BlockHeight): Block | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    getBlock(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): Block | undefined {
        if (height === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
            return this.hashToBlockMap.get(hashOrForkId as Hash);
        }
        // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
        const coordinateKey = this.coordinatesToKey({
            forkId: hashOrForkId as ForkId,
            height
        });
        return this.coordinatesToBlockMap.get(coordinateKey);
    }

    // ====================================
    // UPDATE - Signature insertion
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      INSERT SIGNATURE - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Insert signature by hash */
    insertSignature(signature: Signature, blockHash: Hash): Block | undefined;

    /** [OVERLOAD 2] Insert signature by coordinates */
    insertSignature(
        signature: Signature,
        forkId: ForkId,
        height: BlockHeight
    ): Block | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    insertSignature(
        signature: Signature,
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): Block | undefined {
        const block =
            height === undefined
                ? this.hashToBlockMap.get(hashOrForkId as Hash)
                : this.coordinatesToBlockMap.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );

        if (!block) return undefined;

        block.expandSignatures([signature]);
        const persistedHash =
            height === undefined
                ? (hashOrForkId as Hash)
                : (this.persistedHashByBlock.get(block) ?? block.hash);
        this.dirtyHashes.markDirty(persistedHash);
        return block;
    }

    // ====================================
    // UPDATE - On-chain timestamp
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      SET ON-CHAIN TIMESTAMP - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Set on-chain timestamp by hash */
    setOnChainTimestamp(blockHash: Hash, timestamp: Timestamp): boolean;

    /** [OVERLOAD 2] Set on-chain timestamp by coordinates */
    setOnChainTimestamp(
        forkId: ForkId,
        height: BlockHeight,
        timestamp: Timestamp
    ): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    setOnChainTimestamp(
        hashOrForkId: Hash | ForkId,
        timestampOrHeight: Timestamp | BlockHeight,
        timestamp?: Timestamp
    ): boolean {
        let block: Block | undefined;

        if (timestamp === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
            block = this.hashToBlockMap.get(hashOrForkId as Hash);
            if (block) {
                block.onChainTimestamp = timestampOrHeight as Timestamp;
                this.dirtyHashes.markDirty(hashOrForkId as Hash);
                return true;
            }
            return false;
        }
        // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
        const coordinateKey = this.coordinatesToKey({
            forkId: hashOrForkId as ForkId,
            height: timestampOrHeight as BlockHeight
        });
        block = this.coordinatesToBlockMap.get(coordinateKey);
        if (block) {
            block.onChainTimestamp = timestamp;
            this.dirtyHashes.markDirty(
                this.persistedHashByBlock.get(block) ?? block.hash
            );
            return true;
        }
        return false;
    }

    // ====================================
    // DELETE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Delete block entry by hash */
    deleteBlock(blockHash: Hash): boolean;

    /** [OVERLOAD 2] Delete block entry by coordinates */
    deleteBlock(forkId: ForkId, height: BlockHeight): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    deleteBlock(hashOrForkId: Hash | ForkId, height?: BlockHeight): boolean {
        if (height === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - delete by hash
            const persistedHash = hashOrForkId as Hash;
            const block = this.hashToBlockMap.get(persistedHash);
            if (!block) return false;

            // Need to find and delete from coordinates map too
            const coordinateKey = this.coordinatesToKey(block.coordinates);

            this.hashToBlockMap.delete(persistedHash);
            this.coordinatesToBlockMap.delete(coordinateKey);
            this.justPersistHashes.delete(persistedHash);
            this.persistedHashByBlock.delete(block);
            this.dirtyHashes.markDirty(persistedHash);

            const blockHeight = block.height;
            if (blockHeight === this.forkIdToMaxHeightMap.get(block.forkId)) {
                this.forkIdToMaxHeightMap.set(
                    block.forkId,
                    Math.max(0, blockHeight - 1)
                );
            }

            return true;
        }

        // ┌─ ROUTES TO: [OVERLOAD 2] - delete by coordinates
        const forkId = hashOrForkId as ForkId;
        const coordinateKey = this.coordinatesToKey({
            forkId: forkId,
            height
        });
        const block = this.coordinatesToBlockMap.get(coordinateKey);
        if (!block) return false;

        // Need to find and delete from hash map too - use the key it was
        // actually STORED under (FO4), not block's own intrinsic hash, which
        // can diverge from a caller-supplied override.
        const blockHash = this.persistedHashByBlock.get(block) ?? block.hash;

        this.coordinatesToBlockMap.delete(coordinateKey);
        this.hashToBlockMap.delete(blockHash);
        this.justPersistHashes.delete(blockHash);
        this.persistedHashByBlock.delete(block);
        this.dirtyHashes.markDirty(blockHash);

        if (height === this.forkIdToMaxHeightMap.get(forkId)) {
            this.forkIdToMaxHeightMap.set(forkId, Math.max(0, height - 1));
        }

        return true;
    }

    getNextBlockHeight(forkId: ForkId): BlockHeight {
        if (this.forkIdToMaxHeightMap.has(forkId)) {
            return this.forkIdToMaxHeightMap.get(forkId)! + 1;
        }
        return 0;
    }

    /*────────────────────────────────────────────────────────────────────────────
      GET ALL BLOCKS BY FORK ID - SEQUENTIAL ITERATOR
    ────────────────────────────────────────────────────────────────────────────*/
    *getIterator(
        forkId: ForkId,
        sortOrder?: SortOrder,
        startHeight?: BlockHeight
    ): Generator<Block, void, unknown> {
        const maxHeight = this.forkIdToMaxHeightMap.get(forkId);
        if (maxHeight === undefined) return;
        if (startHeight !== undefined && startHeight < 0) return;

        if (sortOrder === SortOrder.ASC) {
            // Start from startHeight or 0, go up to maxHeight
            const start = startHeight !== undefined ? startHeight : 0;
            for (let height = start; height <= maxHeight; height++) {
                const coordinateKey = this.coordinatesToKey({ forkId, height });
                const block = this.coordinatesToBlockMap.get(coordinateKey);
                if (block) {
                    yield block;
                }
            }
        } else {
            // Start from startHeight or maxHeight, go down to 0. Clamp to
            // maxHeight so a caller passing an absurd startHeight (e.g. a
            // remote-supplied sync target) can't loop over the empty range
            // above the fork's tip and stall the event loop.
            const start =
                startHeight !== undefined
                    ? Math.min(startHeight, maxHeight)
                    : maxHeight;
            for (let height = start; height >= 0; height--) {
                const coordinateKey = this.coordinatesToKey({ forkId, height });
                const block = this.coordinatesToBlockMap.get(coordinateKey);
                if (block) {
                    yield block;
                }
            }
        }
    }

    getLatestBlock(forkId: ForkId): Block | undefined {
        const blockIterator = this.getIterator(forkId, SortOrder.DESC);
        const iteratorResult = blockIterator.next();
        return iteratorResult.done ? undefined : iteratorResult.value;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private coordinatesToKey(coordinates: BlockCoordinates): CoordinateKey {
        return `${coordinates.forkId}:${coordinates.height}`;
    }

    private _storeBlockWithOptions(
        block: Block,
        options?: StoreOptions
    ): Hash | undefined {
        // Determine hash - use provided or compute
        const blockHash = options?.hash ?? block.hash;

        // Determine coordinates - use provided or compute
        const coordinates = options?.coordinates ?? block.coordinates;

        // Store the block entry
        const coordinateKey = this.coordinatesToKey(coordinates);
        const existingBlock = this.coordinatesToBlockMap.get(coordinateKey);

        if (!existingBlock) {
            // Store new block entry
            this.hashToBlockMap.set(blockHash, block);
            this.coordinatesToBlockMap.set(coordinateKey, block);
            this.persistedHashByBlock.set(block, blockHash);

            // Update max height unless this is a persistence-only operation
            if (!options?.justPersist) {
                this._updateMaxHeight(coordinates.forkId, coordinates.height);
            }

            // justPersist blocks (e.g. dispute-proof milestones ahead of the
            // live tip) are never write-through persisted: the flag isn't part
            // of the persisted blob, so hydrate() would replay them with
            // options: undefined and incorrectly advance forkIdToMaxHeightMap
            // on restart. These milestones are re-derived from the state
            // proof on the next replay instead. persistableEntries() excludes
            // the tracked hashes so the engine never diffs them.
            this._trackJustPersist(blockHash, options?.justPersist);
            this.dirtyHashes.markDirty(blockHash);
            return blockHash;
        }

        if (!block.equals(existingBlock)) {
            // Not equal => abort
            return undefined;
        }

        // Resolve the key existingBlock is actually STORED under (FO4) -
        // not this call's blockHash, which is only this call's own
        // override/content hash and can diverge from the block's persisted
        // identity across two calls with different options.
        const persistedHash =
            this.persistedHashByBlock.get(existingBlock) ?? existingBlock.hash;

        // They are equal => merge signatures
        existingBlock.expandSignatures(block.confirmationSignatures);
        if (block.onChainTimestamp !== undefined) {
            existingBlock.onChainTimestamp = block.onChainTimestamp;
        }

        // A merge only ever PROMOTES to durable (justPersist -> normal); it
        // never demotes an already-existing record to justPersist. Demoting
        // here would mean a dispute replay of an already-durable block (e.g.
        // persistDisputeDataWithoutAudit re-storing a hash with
        // justPersist:true) removes it from persistableEntries() and gets
        // deleted from the durable store on the next flush.
        if (!options?.justPersist) {
            this._trackJustPersist(persistedHash, false);
            // FR1: a justPersist -> normal promotion must advance the live
            // tip exactly like a brand-new normal block does (see the
            // `!options?.justPersist` branch above) - otherwise a fresh
            // hydrate (which replays this now-durable record through the
            // "new entry" branch) advances forkIdToMaxHeightMap past where
            // the live in-memory promotion left it, and live/restarted state
            // disagree on getNextBlockHeight().
            this._updateMaxHeight(coordinates.forkId, coordinates.height);
        }
        this.dirtyHashes.markDirty(persistedHash);
        // Return the hash actually stored under (same object in both maps)
        return persistedHash;
    }

    /**
     * Record (or clear) a hash's justPersist status. A hash later re-stored
     * without justPersist becomes persistable again.
     */
    private _trackJustPersist(hash: Hash, justPersist?: boolean): void {
        if (justPersist) {
            this.justPersistHashes.add(hash);
        } else {
            this.justPersistHashes.delete(hash);
        }
    }

    private _updateMaxHeight(forkId: ForkId, height: BlockHeight): void {
        const currentMax = this.forkIdToMaxHeightMap.get(forkId);
        if (currentMax === undefined || height > currentMax) {
            this.forkIdToMaxHeightMap.set(forkId, height);
        }
    }
}
