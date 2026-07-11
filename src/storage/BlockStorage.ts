import { ethers } from "ethers";
import { Hash, ForkId, BlockHeight, Signature, Timestamp } from "@/types/types";
import { Block, BlockCoordinates } from "@/models";
import { Codec, Type } from "@/utils/Codec";
import { IStoragePersistence } from "./persistence/IStoragePersistence";
import { InMemoryPersistence } from "./persistence/InMemoryPersistence";

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

    private readonly persistence: IStoragePersistence;
    private static readonly persistenceAbiCoder =
        ethers.AbiCoder.defaultAbiCoder();

    constructor(persistence: IStoragePersistence = new InMemoryPersistence()) {
        this.hashToBlockMap = new Map();
        this.coordinatesToBlockMap = new Map();
        this.forkIdToMaxHeightMap = new Map();
        this.persistence = persistence;
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /**
     * Rebuild the in-memory maps from the persistence port. Order-independent
     * and tolerant of corrupt/truncated entries (e.g. a crash mid-write) -
     * those are skipped via the error hook rather than throwing. forkIdToMaxHeightMap
     * is never persisted directly; it is rebuilt here from the loaded blocks.
     */
    async hydrate(): Promise<void> {
        this.hashToBlockMap.clear();
        this.coordinatesToBlockMap.clear();
        this.forkIdToMaxHeightMap.clear();

        for await (const { encodedBlock } of this.persistence.loadAll()) {
            try {
                const block = this.decodeForPersistence(encodedBlock);
                // Already persisted - skip write-through, but do rebuild maxHeight.
                this._storeBlockWithOptions(block, undefined, false);
            } catch (err) {
                this.persistence.onError?.(err);
            }
        }
    }

    /**
     * Pack the block's full mutable state (signatures + onChainTimestamp) into a
     * single encoded blob. The block's own struct is Codec-encoded; the outer
     * wrapper (signature/confirmations/timestamp) uses the same ABI-encoding
     * mechanism rather than structuredClone (BytesLike/bigint don't survive that).
     */
    private encodeForPersistence(block: Block): string {
        const encodedConfirmation = Codec.encode(
            block.blockConfirmationStruct,
            Type.BlockConfirmation
        );
        return BlockStorage.persistenceAbiCoder.encode(
            ["bytes", "uint256"],
            [encodedConfirmation, block.onChainTimestamp ?? 0]
        );
    }

    private decodeForPersistence(encodedBlock: string): Block {
        const [encodedConfirmation, onChainTimestampRaw] =
            BlockStorage.persistenceAbiCoder.decode(
                ["bytes", "uint256"],
                encodedBlock
            );
        const blockConfirmation = Codec.decode(
            encodedConfirmation,
            Type.BlockConfirmation
        );
        const onChainTimestamp =
            onChainTimestampRaw === 0n
                ? undefined
                : Number(onChainTimestampRaw);
        return Block.fromBlockConfirmation(blockConfirmation, onChainTimestamp);
    }

    private writeThroughPersistBlock(block: Block): void {
        try {
            this.persistence.persistBlock(this.encodeForPersistence(block), {
                hash: block.hash,
                forkId: block.forkId,
                height: block.height
            });
        } catch (err) {
            this.persistence.onError?.(err);
        }
    }

    private writeThroughDeleteBlock(hash: Hash): void {
        try {
            this.persistence.deleteBlock({ hash });
        } catch (err) {
            this.persistence.onError?.(err);
        }
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
        this.writeThroughPersistBlock(block);
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
                this.writeThroughPersistBlock(block);
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
            this.writeThroughPersistBlock(block);
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
            const block = this.hashToBlockMap.get(hashOrForkId as Hash);
            if (!block) return false;

            // Need to find and delete from coordinates map too
            const coordinateKey = this.coordinatesToKey(block.coordinates);

            this.hashToBlockMap.delete(hashOrForkId as Hash);
            this.coordinatesToBlockMap.delete(coordinateKey);

            const blockHeight = block.height;
            if (blockHeight === this.forkIdToMaxHeightMap.get(block.forkId)) {
                this.forkIdToMaxHeightMap.set(
                    block.forkId,
                    Math.max(0, blockHeight - 1)
                );
            }

            this.writeThroughDeleteBlock(block.hash);
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

        // Need to find and delete from hash map too
        const blockHash = block.hash;

        this.coordinatesToBlockMap.delete(coordinateKey);
        this.hashToBlockMap.delete(blockHash);

        if (height === this.forkIdToMaxHeightMap.get(forkId)) {
            this.forkIdToMaxHeightMap.set(forkId, Math.max(0, height - 1));
        }

        this.writeThroughDeleteBlock(blockHash);
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
        options?: StoreOptions,
        persist: boolean = true
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

            // Update max height unless this is a persistence-only operation
            if (!options?.justPersist) {
                this._updateMaxHeight(coordinates.forkId, coordinates.height);
            }

            if (persist) this.writeThroughPersistBlock(block);
            return blockHash;
        }

        if (!block.equals(existingBlock)) {
            // Not equal => abort
            return undefined;
        }

        // They are equal => merge signatures
        existingBlock.expandSignatures(block.confirmationSignatures);
        if (block.onChainTimestamp !== undefined) {
            existingBlock.onChainTimestamp = block.onChainTimestamp;
        }

        if (persist) this.writeThroughPersistBlock(existingBlock);
        // Return the hash (same object in both maps)
        return blockHash;
    }

    private _updateMaxHeight(forkId: ForkId, height: BlockHeight): void {
        const currentMax = this.forkIdToMaxHeightMap.get(forkId);
        if (currentMax === undefined || height > currentMax) {
            this.forkIdToMaxHeightMap.set(forkId, height);
        }
    }
}
