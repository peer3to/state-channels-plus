import { coordinateKey, CoordinateKey } from "./keys";
import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import type { PersistedBlockRecord } from "./persistence/storageCodecs";
import { Block, BlockCoordinates } from "@/models";
import { Hash, ForkId, BlockHeight, Signature, Timestamp } from "@/types/types";
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
    private readonly hashToCoordinatesMap = new Map<Hash, CoordinateKey>();
    // the record also keeps whether the block's first store advanced the tip
    private readonly coordinatesToBlockMap: PersistentCollection<
        CoordinateKey,
        PersistedBlockRecord
    >;

    // NEW: Track highest height for each forkId
    private readonly forkIdToMaxHeightMap = new Map<ForkId, BlockHeight>();

    constructor(controller?: PersistenceController) {
        this.coordinatesToBlockMap = new PersistentCollection(
            "blocks",
            controller,
            () => this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE
    // ====================================

    storeBlock(block: Block, options?: StoreOptions): Hash | undefined {
        // Determine hash - use provided or compute
        const blockHash = options?.hash ?? block.hash;

        // Determine coordinates - use provided or compute
        const coordinates = options?.coordinates ?? block.coordinates;

        // Store the block entry
        const coordinateKey = this.coordinatesToKey(coordinates);
        const existing = this.coordinatesToBlockMap.get(coordinateKey);

        if (!existing) {
            // Store new block entry
            this.hashToCoordinatesMap.set(blockHash, coordinateKey);
            this.coordinatesToBlockMap.set(coordinateKey, {
                block,
                coordinates,
                advancesTip: !options?.justPersist
            });

            // Update max height unless this is a persistence-only operation
            if (!options?.justPersist) {
                this._updateMaxHeight(coordinates.forkId, coordinates.height);
            }

            return blockHash;
        }

        if (!block.equals(existing.block)) {
            // Not equal => abort
            return undefined;
        }

        // They are equal => merge signatures
        this.coordinatesToBlockMap.update(coordinateKey, (record) => {
            record!.block.mergeFrom(block);
            return record;
        });

        return blockHash;
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
        const key = this.findKey(hashOrForkId, height);
        return key === undefined
            ? undefined
            : this.coordinatesToBlockMap.get(key)?.block;
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
        const key = this.findKey(hashOrForkId, height);
        if (key === undefined || !this.coordinatesToBlockMap.has(key)) {
            return undefined;
        }
        return this.coordinatesToBlockMap.update(key, (record) => {
            record!.block.expandSignatures([signature]);
            return record;
        })!.block;
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
        let key: CoordinateKey | undefined;
        let onChainTimestamp: Timestamp;
        if (timestamp === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
            key = this.findKey(hashOrForkId);
            onChainTimestamp = timestampOrHeight;
        } else {
            // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
            key = this.findKey(hashOrForkId, timestampOrHeight);
            onChainTimestamp = timestamp;
        }
        if (key === undefined || !this.coordinatesToBlockMap.has(key)) {
            return false;
        }
        this.coordinatesToBlockMap.update(key, (record) => {
            record!.block.onChainTimestamp = onChainTimestamp;
            return record;
        });
        return true;
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
        const key = this.findKey(hashOrForkId, height);
        const record =
            key === undefined ? undefined : this.coordinatesToBlockMap.get(key);
        if (!record) return false;

        // Need to find and delete from hash map too
        this.coordinatesToBlockMap.delete(key!);
        this.hashToCoordinatesMap.delete(
            height === undefined ? (hashOrForkId as Hash) : record.block.hash
        );

        const { forkId, height: blockHeight } = record.coordinates;
        if (blockHeight === this.forkIdToMaxHeightMap.get(forkId)) {
            this.forkIdToMaxHeightMap.set(forkId, Math.max(0, blockHeight - 1));
        }

        return true;
    }

    getNextBlockHeight(forkId: ForkId): BlockHeight {
        return this.getLatestBlockHeight(forkId) + 1;
    }

    // -1 when the fork holds no block yet (its genesis is the latest state)
    getLatestBlockHeight(forkId: ForkId): BlockHeight {
        return this.forkIdToMaxHeightMap.get(forkId) ?? -1;
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
                const block = this.getBlock(forkId, height);
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
                const block = this.getBlock(forkId, height);
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

    private findKey(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): CoordinateKey | undefined {
        // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
        if (height === undefined) {
            return this.hashToCoordinatesMap.get(hashOrForkId as Hash);
        }
        // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
        return this.coordinatesToKey({
            forkId: hashOrForkId as ForkId,
            height
        });
    }

    private coordinatesToKey(coordinates: BlockCoordinates): CoordinateKey {
        return coordinateKey(coordinates.forkId, coordinates.height);
    }

    private _updateMaxHeight(forkId: ForkId, height: BlockHeight): void {
        const currentMax = this.forkIdToMaxHeightMap.get(forkId);
        if (currentMax === undefined || height > currentMax) {
            this.forkIdToMaxHeightMap.set(forkId, height);
        }
    }

    // after a load: the hash index and the tip of every fork
    private rebuildIndexes(): void {
        this.hashToCoordinatesMap.clear();
        this.forkIdToMaxHeightMap.clear();
        for (const [key, record] of this.coordinatesToBlockMap.entries()) {
            this.hashToCoordinatesMap.set(record.block.hash, key);
            if (record.advancesTip) {
                this._updateMaxHeight(
                    record.coordinates.forkId,
                    record.coordinates.height
                );
            }
        }
    }
}
