import { Block, BlockCoordinates } from "@/models";
import { BlockHeight, ForkId, Hash, Signature, Timestamp } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import type { PersistedBlockRecord } from "./persistence/storageCodecs";

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
    private readonly records: PersistentCollection<Hash, PersistedBlockRecord>;
    private readonly coordinateToHash = new Map<CoordinateKey, Hash>();

    // NEW: Track highest height for each forkId
    private readonly forkIdToMaxHeightMap = new Map<ForkId, BlockHeight>();

    constructor(controller?: PersistenceController) {
        this.records = new PersistentCollection("blocks", controller, () =>
            this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeBlock(block: Block, options?: StoreOptions): Hash | undefined {
        // Determine hash - use provided or compute
        const blockHash = options?.hash ?? block.hash;

        // Determine coordinates - use provided or compute
        const coordinates = options?.coordinates ?? block.coordinates;

        // Store the block entry
        let compatible = true;
        this.records.update(blockHash, (record) => {
            const coordinateKey = this.coordinatesToKey(coordinates);
            const storedCoordinateHash =
                this.coordinateToHash.get(coordinateKey);
            if (storedCoordinateHash && storedCoordinateHash !== blockHash) {
                // Not equal => abort
                compatible = false;
                return record;
            }

            if (!record) {
                // Store new block entry
                return {
                    block,
                    coordinates,
                    advancesTip: !options?.justPersist
                };
            }
            if (
                !block.equals(record.block) ||
                this.coordinatesToKey(record.coordinates) !== coordinateKey
            ) {
                // Not equal => abort
                compatible = false;
                return record;
            }

            // They are equal => merge signatures
            record.block.expandSignatures(block.confirmationSignatures);
            if (block.onChainTimestamp !== undefined) {
                record.block.onChainTimestamp = block.onChainTimestamp;
            }
            if (!options?.justPersist) record.advancesTip = true;
            return record;
        });
        if (!compatible) return undefined;

        // Update max height unless this is a persistence-only operation
        return blockHash;
    }

    // ====================================
    // READ
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get block entry by hash */
    public getBlock(blockHash: Hash): Block | undefined;

    /** [OVERLOAD 2] Get block entry by coordinates */
    public getBlock(forkId: ForkId, height: BlockHeight): Block | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    public getBlock(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): Block | undefined {
        if (height === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
            return this.records.get(hashOrForkId as Hash)?.block;
        }
        // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
        const hash = this.coordinateToHash.get(
            this.coordinatesToKey({
                forkId: hashOrForkId as ForkId,
                height
            })
        );
        return hash ? this.records.get(hash)?.block : undefined;
    }

    // ====================================
    // UPDATE - Signature insertion
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      INSERT SIGNATURE - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Insert signature by hash */
    public insertSignature(
        signature: Signature,
        blockHash: Hash
    ): Block | undefined;

    /** [OVERLOAD 2] Insert signature by coordinates */
    public insertSignature(
        signature: Signature,
        forkId: ForkId,
        height: BlockHeight
    ): Block | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    public insertSignature(
        signature: Signature,
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): Block | undefined {
        const blockHash =
            height === undefined
                ? (hashOrForkId as Hash)
                : this.coordinateToHash.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );
        if (!blockHash) return undefined;
        const updated = this.records.update(blockHash, (record) => {
            record?.block.expandSignatures([signature]);
            return record;
        });
        return updated?.block;
    }

    // ====================================
    // UPDATE - On-chain timestamp
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      SET ON-CHAIN TIMESTAMP - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Set on-chain timestamp by hash */
    public setOnChainTimestamp(blockHash: Hash, timestamp: Timestamp): boolean;

    /** [OVERLOAD 2] Set on-chain timestamp by coordinates */
    public setOnChainTimestamp(
        forkId: ForkId,
        height: BlockHeight,
        timestamp: Timestamp
    ): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    public setOnChainTimestamp(
        hashOrForkId: Hash | ForkId,
        timestampOrHeight: Timestamp | BlockHeight,
        timestamp?: Timestamp
    ): boolean {
        const blockHash =
            timestamp === undefined
                ? (hashOrForkId as Hash)
                : this.coordinateToHash.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height: timestampOrHeight as BlockHeight
                      })
                  );
        if (!blockHash || !this.records.has(blockHash)) return false;
        this.records.update(blockHash, (record) => {
            if (record) {
                record.block.onChainTimestamp =
                    timestamp ?? (timestampOrHeight as Timestamp);
            }
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
    public deleteBlock(blockHash: Hash): boolean;

    /** [OVERLOAD 2] Delete block entry by coordinates */
    public deleteBlock(forkId: ForkId, height: BlockHeight): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    public deleteBlock(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): boolean {
        if (height === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - delete by hash
            // Need to find and delete from coordinates map too
        } else {
            // ┌─ ROUTES TO: [OVERLOAD 2] - delete by coordinates
            // Need to find and delete from hash map too
        }
        const blockHash =
            height === undefined
                ? (hashOrForkId as Hash)
                : this.coordinateToHash.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );
        if (!blockHash) return false;
        return this.records.delete(blockHash);
    }

    public getNextBlockHeight(forkId: ForkId): BlockHeight {
        const maxHeight = this.forkIdToMaxHeightMap.get(forkId);
        return maxHeight === undefined ? 0 : maxHeight + 1;
    }

    /*────────────────────────────────────────────────────────────────────────────
      GET ALL BLOCKS BY FORK ID - SEQUENTIAL ITERATOR
    ────────────────────────────────────────────────────────────────────────────*/
    public *getIterator(
        forkId: ForkId,
        sortOrder?: SortOrder,
        startHeight?: BlockHeight
    ): Generator<Block, void, unknown> {
        const maxHeight = this.forkIdToMaxHeightMap.get(forkId);
        if (maxHeight === undefined) return;
        if (startHeight !== undefined && startHeight < 0) return;

        if (sortOrder === SortOrder.ASC) {
            // Start from startHeight or 0, go up to maxHeight
            const start = startHeight ?? 0;
            for (let height = start; height <= maxHeight; height++) {
                const block = this.getBlock(forkId, height);
                if (block) yield block;
            }
            return;
        }

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
            if (block) yield block;
        }
    }

    public getLatestBlock(forkId: ForkId): Block | undefined {
        const result = this.getIterator(forkId, SortOrder.DESC).next();
        return result.done ? undefined : result.value;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    public rebuildIndexes(): void {
        this.coordinateToHash.clear();
        this.forkIdToMaxHeightMap.clear();
        for (const [hash, record] of this.records.entries()) {
            const coordinateKey = this.coordinatesToKey(record.coordinates);
            const existingHash = this.coordinateToHash.get(coordinateKey);
            if (existingHash && existingHash !== hash) {
                throw new Error(
                    `Conflicting persisted blocks at ${coordinateKey}`
                );
            }
            this.indexRecord(hash, record);
        }
    }

    private coordinatesToKey(coordinates: BlockCoordinates): CoordinateKey {
        return `${coordinates.forkId}:${coordinates.height}`;
    }

    private indexRecord(hash: Hash, record: PersistedBlockRecord): void {
        this.coordinateToHash.set(
            this.coordinatesToKey(record.coordinates),
            hash
        );
        if (!record.advancesTip) return;
        const currentMax = this.forkIdToMaxHeightMap.get(
            record.coordinates.forkId
        );
        if (
            currentMax === undefined ||
            record.coordinates.height > currentMax
        ) {
            this.forkIdToMaxHeightMap.set(
                record.coordinates.forkId,
                record.coordinates.height
            );
        }
    }
}
