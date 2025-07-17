import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    Hash,
    ForkId,
    BlockHeight,
    Signature,
    Bytes,
    Timestamp
} from "@/types/types";
import { ethers } from "ethers";
import { Block, BlockCoordinates } from "@/models";

type CoordinateKey = string;
type StoreOptions = {
    hash?: Hash;
    coordinates?: BlockCoordinates;
};

export type BlockEntry = {
    blockConfirmation: BlockConfirmationStruct;
    onChainTimestamp?: Timestamp;
};

export class BlockStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private hashToBlockMap: Map<Hash, BlockEntry>;
    private coordinatesToBlockMap: Map<CoordinateKey, BlockEntry>;

    constructor() {
        this.hashToBlockMap = new Map();
        this.coordinatesToBlockMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      STORE  BLOCK - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeBlock(signedBlock: SignedBlockStruct, options?: StoreOptions): Hash {
        // Convert SignedBlock to BlockConfirmation (empty signatures)
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: [] // Starts empty, ready for peer confirmations
        };

        return this._storeBlockEntryWithOptions({ blockConfirmation }, options);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE BLOCK CONFIRMATION - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        options?: StoreOptions
    ): Hash {
        return this._storeBlockEntryWithOptions({ blockConfirmation }, options);
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
    insertSignature(
        signature: Signature,
        blockHash: Hash
    ): BlockConfirmationStruct | undefined;

    /** [OVERLOAD 2] Insert signature by coordinates */
    insertSignature(
        signature: Signature,
        forkId: ForkId,
        height: BlockHeight
    ): BlockConfirmationStruct | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    insertSignature(
        signature: Signature,
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): BlockConfirmationStruct | undefined {
        const blockEntry =
            height === undefined
                ? this.hashToBlockMap.get(hashOrForkId as Hash)
                : this.coordinatesToBlockMap.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );

        if (blockEntry) {
            const blockConfirmation = blockEntry.blockConfirmation;
            // Check for duplicate signature before adding
            if (!blockConfirmation.signatures.includes(signature as Bytes)) {
                blockConfirmation.signatures.push(signature as Bytes);
            }
            return blockConfirmation;
        }
        return undefined;
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
            const block = Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );
            const coordinateKey = this.coordinatesToKey(block.coordinates);

            this.hashToBlockMap.delete(hashOrForkId as Hash);
            this.coordinatesToBlockMap.delete(coordinateKey);
            return true;
        }

        // ┌─ ROUTES TO: [OVERLOAD 2] - delete by coordinates
        const coordinateKey = this.coordinatesToKey({
            forkId: hashOrForkId as ForkId,
            height
        });
        const blockEntry = this.coordinatesToBlockMap.get(coordinateKey);
        if (!blockEntry) return false;

        // Need to find and delete from hash map too
        const blockHash = ethers.keccak256(
            blockEntry.blockConfirmation.signedBlock.encodedBlock
        );

        this.coordinatesToBlockMap.delete(coordinateKey);
        this.hashToBlockMap.delete(blockHash);
        return true;
    }

    /*────────────────────────────────────────────────────────────────────────────
      GET ALL BLOCKS BY FORK ID
    ────────────────────────────────────────────────────────────────────────────*/
    getBlocksByForkId(
        forkId: ForkId,
        sortOrder?: "asc" | "desc"
    ): BlockEntry[] {
        const blocks: Array<{ height: BlockHeight; entry: BlockEntry }> = [];

        // Iterate through coordinate keys and filter by forkId
        for (const [key, blockEntry] of this.coordinatesToBlockMap) {
            const [keyForkId, blockHeight] = key.split(":");
            if (keyForkId === forkId) {
                blocks.push({
                    height: parseInt(blockHeight),
                    entry: blockEntry
                });
            }
        }

        // Sort if requested
        if (sortOrder) {
            blocks.sort((a, b) => {
                return sortOrder === "asc"
                    ? a.height - b.height
                    : b.height - a.height;
            });
        }

        return blocks.map((item) => item.entry);
    }

    /*────────────────────────────────────────────────────────────────────────────
      GET ORIGINAL SIGNATURE - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get original signature by hash */
    getOriginalSignature(blockHash: Hash): Signature | undefined;

    /** [OVERLOAD 2] Get original signature by block object */
    getOriginalSignature(block: Block): Signature | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    getOriginalSignature(hashOrBlock: Hash | Block): Signature | undefined {
        const blockHash =
            hashOrBlock instanceof Block ? hashOrBlock.hash : hashOrBlock;

        const blockEntry = this.hashToBlockMap.get(blockHash);
        if (!blockEntry) return undefined;

        return blockEntry.blockConfirmation.signedBlock.signature as Signature;
    }

    /*────────────────────────────────────────────────────────────────────────────
      GET SIGNATURES - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get all signatures by hash */
    getSignatures(blockHash: Hash): Signature[];

    /** [OVERLOAD 2] Get all signatures by block object */
    getSignatures(block: Block): Signature[];

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    getSignatures(hashOrBlock: Hash | Block): Signature[] {
        const blockHash =
            hashOrBlock instanceof Block ? hashOrBlock.hash : hashOrBlock;

        const blockEntry = this.hashToBlockMap.get(blockHash);
        if (!blockEntry) return [];

        return blockEntry.blockConfirmation.signatures as Signature[];
    }

    /*────────────────────────────────────────────────────────────────────────────
      DOES SIGNATURE EXIST - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Check if signature exists by hash */
    doesSignatureExist(blockHash: Hash, signature: Signature): boolean;

    /** [OVERLOAD 2] Check if signature exists by block object */
    doesSignatureExist(block: Block, signature: Signature): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    doesSignatureExist(
        hashOrBlock: Hash | Block,
        signature: Signature
    ): boolean {
        const blockHash =
            hashOrBlock instanceof Block ? hashOrBlock.hash : hashOrBlock;

        const blockEntry = this.hashToBlockMap.get(blockHash);
        if (!blockEntry) return false;

        if (blockEntry.blockConfirmation.signedBlock.signature === signature) {
            return true;
        }

        return blockEntry.blockConfirmation.signatures.includes(
            signature as Bytes
        );
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
    ): Hash {
        // Determine hash - use provided or compute
        const blockHash =
            options?.hash ??
            ethers.keccak256(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );

        // Determine coordinates - use provided or compute
        const coordinates =
            options?.coordinates ??
            Block.decode(blockEntry.blockConfirmation.signedBlock.encodedBlock)
                .coordinates;

        // Store the block entry
        const coordinateKey = this.coordinatesToKey(coordinates);
        const existingEntry = this.hashToBlockMap.get(blockHash);

        if (existingEntry !== undefined) {
            // Merge signatures
            const signaturesSet = new Set(
                existingEntry.blockConfirmation.signatures
            );
            for (const newSignature of blockEntry.blockConfirmation
                .signatures) {
                signaturesSet.add(newSignature);
            }
            existingEntry.blockConfirmation.signatures =
                Array.from(signaturesSet);

            // Update on-chain timestamp if provided
            if (blockEntry.onChainTimestamp !== undefined) {
                existingEntry.onChainTimestamp = blockEntry.onChainTimestamp;
            }

            return blockHash;
        }

        // If no existing block, store new block entry
        this.hashToBlockMap.set(blockHash, blockEntry);
        this.coordinatesToBlockMap.set(coordinateKey, blockEntry);
        return blockHash;
    }
}
