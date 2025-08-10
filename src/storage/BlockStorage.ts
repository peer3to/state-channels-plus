import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight, Signature, Timestamp } from "@/types/types";
import { Block, BlockCoordinates } from "@/models";

type CoordinateKey = string;
type StoreOptions = {
    hash?: Hash;
    coordinates?: BlockCoordinates;
};

export type BlockEntry = {
    block: Block;
    onChainTimestamp?: Timestamp;
};

export enum SortOrder {
    ASC = "asc",
    DESC = "desc"
}

export class BlockStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private hashToBlockMap: Map<Hash, BlockEntry>;
    private coordinatesToBlockMap: Map<CoordinateKey, BlockEntry>;

    // NEW: Track highest height for each forkId
    private forkIdToMaxHeightMap: Map<ForkId, BlockHeight>;

    constructor() {
        this.hashToBlockMap = new Map();
        this.coordinatesToBlockMap = new Map();
        this.forkIdToMaxHeightMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      STORE  BLOCK - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeSignedBlock(
        signedBlock: SignedBlockStruct,
        options?: StoreOptions
    ): Hash | undefined {
        // Convert SignedBlock to BlockConfirmation (empty signatures)
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: [] // Starts empty, ready for peer confirmations
        };
        const block = Block.fromBlockConfirmation(blockConfirmation);

        return this._storeBlockEntryWithOptions({ block }, options);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE BLOCK CONFIRMATION - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeBlock(block: Block, options?: StoreOptions): Hash | undefined {
        return this._storeBlockEntryWithOptions({ block }, options);
    }

    // ====================================
    // READ
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get block entry by hash */
    getBlockEntry(blockHash: Hash): BlockEntry | undefined;

    /** [OVERLOAD 2] Get block entry by coordinates */
    getBlockEntry(forkId: ForkId, height: BlockHeight): BlockEntry | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    getBlockEntry(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): BlockEntry | undefined {
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
    // UPDATE - Signature insertion and on-chain timestamp setting
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
        let blockEntry: BlockEntry | undefined;

        if (timestamp === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - by hash
            blockEntry = this.hashToBlockMap.get(hashOrForkId as Hash);
            if (blockEntry) {
                blockEntry.onChainTimestamp = timestampOrHeight as Timestamp;
                return true;
            }
            return false;
        }
        // ┌─ ROUTES TO: [OVERLOAD 2] - by coordinates
        const coordinateKey = this.coordinatesToKey({
            forkId: hashOrForkId as ForkId,
            height: timestampOrHeight as BlockHeight
        });
        blockEntry = this.coordinatesToBlockMap.get(coordinateKey);
        if (blockEntry) {
            blockEntry.onChainTimestamp = timestamp;
            return true;
        }
        return false;
    }

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
        const blockEntry =
            height === undefined
                ? this.hashToBlockMap.get(hashOrForkId as Hash)
                : this.coordinatesToBlockMap.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );

        return blockEntry?.block.expandSignatures([signature]);
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
            const blockEntry = this.hashToBlockMap.get(hashOrForkId as Hash);
            if (!blockEntry) return false;

            // Need to find and delete from coordinates map too
            const block = blockEntry.block;
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

            return true;
        }

        // ┌─ ROUTES TO: [OVERLOAD 2] - delete by coordinates
        const forkId = hashOrForkId as ForkId;
        const coordinateKey = this.coordinatesToKey({
            forkId: forkId,
            height
        });
        const blockEntry = this.coordinatesToBlockMap.get(coordinateKey);
        if (!blockEntry) return false;

        // Need to find and delete from hash map too
        const blockHash = blockEntry.block.hash;

        this.coordinatesToBlockMap.delete(coordinateKey);
        this.hashToBlockMap.delete(blockHash);

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
    ): Generator<BlockEntry, void, unknown> {
        const maxHeight = this.forkIdToMaxHeightMap.get(forkId);
        if (maxHeight === undefined) return;

        if (sortOrder === SortOrder.ASC) {
            // Start from startHeight or 0, go up to maxHeight
            const start = startHeight !== undefined ? startHeight : 0;
            for (let height = start; height <= maxHeight; height++) {
                const coordinateKey = this.coordinatesToKey({ forkId, height });
                const blockEntry =
                    this.coordinatesToBlockMap.get(coordinateKey);
                if (blockEntry) {
                    yield blockEntry;
                }
            }
        } else {
            // Start from startHeight or maxHeight, go down to 0
            const start = startHeight !== undefined ? startHeight : maxHeight;
            for (let height = start; height >= 0; height--) {
                const coordinateKey = this.coordinatesToKey({ forkId, height });
                const blockEntry =
                    this.coordinatesToBlockMap.get(coordinateKey);
                if (blockEntry) {
                    yield blockEntry;
                }
            }
        }
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private coordinatesToKey(coordinates: BlockCoordinates): CoordinateKey {
        return `${coordinates.forkId}:${coordinates.height}`;
    }

    private _storeBlockEntryWithOptions(
        blockEntry: BlockEntry,
        options?: StoreOptions
    ): Hash | undefined {
        // Determine hash - use provided or compute
        const blockHash = options?.hash ?? blockEntry.block.hash;

        // Determine coordinates - use provided or compute
        const coordinates =
            options?.coordinates ?? blockEntry.block.coordinates;

        // Store the block entry
        const coordinateKey = this.coordinatesToKey(coordinates);
        const existingEntry = this.coordinatesToBlockMap.get(coordinateKey);

        if (!existingEntry) {
            // Store new block entry
            this.hashToBlockMap.set(blockHash, blockEntry);
            this.coordinatesToBlockMap.set(coordinateKey, blockEntry);

            // Update max height
            this._updateMaxHeight(coordinates.forkId, coordinates.height);

            return blockHash;
        }

        if (!blockEntry.block.equals(existingEntry.block)) {
            // Not equal => abort
            return undefined;
        }

        // They are equal => merge signatures
        existingEntry.block.expandSignatures(
            blockEntry.block.confirmationSignatures
        );

        // Update on-chain timestamp if provided
        if (existingEntry.onChainTimestamp === undefined) {
            existingEntry.onChainTimestamp = blockEntry.onChainTimestamp;
        } else if (
            blockEntry.onChainTimestamp !== undefined &&
            blockEntry.onChainTimestamp > existingEntry.onChainTimestamp
        ) {
            // Replace only if new timestamp is greater
            existingEntry.onChainTimestamp = blockEntry.onChainTimestamp;
        }

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
