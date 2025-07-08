import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight, Signature, Bytes } from "@/types/types";
import { ethers } from "ethers";
import { Block, BlockCoordinates } from "@/models";

type CoordinateKey = string;

export class BlockStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private hashToBlockMap: Map<Hash, BlockConfirmationStruct>;
    private coordinatesToBlockMap: Map<CoordinateKey, BlockConfirmationStruct>;

    constructor() {
        this.hashToBlockMap = new Map();
        this.coordinatesToBlockMap = new Map();
    }

    // ====================================
    // CREATE - throw if entry exists
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      INSERT BLOCK - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** Insert signed block with auto-computed keys */
    storeBlock(signedBlock: SignedBlockStruct): Hash;

    /** Insert signed block with provided keys */
    storeBlock(
        signedBlock: SignedBlockStruct,
        blockHash: Hash,
        forkId: ForkId,
        height: BlockHeight
    ): Hash;

    /*────────────────────────────────────────────────────────────────────────────
      STORE  BLOCK - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeBlock(
        signedBlock: SignedBlockStruct,
        blockHash?: Hash,
        forkId?: ForkId,
        height?: BlockHeight
    ): Hash {
        const hasKeys =
            blockHash !== undefined &&
            forkId !== undefined &&
            height !== undefined;

        // Convert SignedBlock to BlockConfirmation (empty signatures)
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock: signedBlock,
            signatures: [] // Starts empty, ready for peer confirmations
        };

        return hasKeys
            ? this._storeBlockConfirmationWithKeys(
                  blockConfirmation,
                  blockHash,
                  { forkId, height }
              )
            : this._storeBlockConfirmation(blockConfirmation);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE BLOCK CONFIRMATION - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** Insert block confirmation with auto-computed keys */
    storeBlockConfirmation(blockConfirmation: BlockConfirmationStruct): Hash;

    /** Insert block confirmation with provided keys */
    storeBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: Hash,
        forkId: ForkId,
        height: BlockHeight
    ): Hash;

    /*────────────────────────────────────────────────────────────────────────────
      STORE BLOCK CONFIRMATION - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        blockHash?: Hash,
        forkId?: ForkId,
        height?: BlockHeight
    ): Hash {
        const hasKeys =
            blockHash !== undefined &&
            forkId !== undefined &&
            height !== undefined;

        return hasKeys
            ? this._storeBlockConfirmationWithKeys(
                  blockConfirmation,
                  blockHash,
                  {
                      forkId,
                      height
                  }
              )
            : this._storeBlockConfirmation(blockConfirmation);
    }

    // ====================================
    // READ
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** [OVERLOAD 1] Get block confirmation by hash */
    getBlockConfirmation(blockHash: Hash): BlockConfirmationStruct | undefined;

    /** [OVERLOAD 2] Get block confirmation by coordinates */
    getBlockConfirmation(
        forkId: ForkId,
        height: BlockHeight
    ): BlockConfirmationStruct | undefined;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    getBlockConfirmation(
        hashOrForkId: Hash | ForkId,
        height?: BlockHeight
    ): BlockConfirmationStruct | undefined {
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
    // UPDATE - Only signature insertion
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      OVERLOAD SIGNATURES
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
        const blockConfirmation =
            height === undefined
                ? this.hashToBlockMap.get(hashOrForkId as Hash)
                : this.coordinatesToBlockMap.get(
                      this.coordinatesToKey({
                          forkId: hashOrForkId as ForkId,
                          height
                      })
                  );

        if (blockConfirmation) {
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

    /** [OVERLOAD 1] Delete block confirmation by hash */
    deleteBlock(blockHash: Hash): boolean;

    /** [OVERLOAD 2] Delete block confirmation by coordinates */
    deleteBlock(forkId: ForkId, height: BlockHeight): boolean;

    /*────────────────────────────────────────────────────────────────────────────
      IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    deleteBlock(hashOrForkId: Hash | ForkId, height?: BlockHeight): boolean {
        if (height === undefined) {
            // ┌─ ROUTES TO: [OVERLOAD 1] - delete by hash
            const blockConfirmation = this.hashToBlockMap.get(
                hashOrForkId as Hash
            );
            if (!blockConfirmation) return false;

            // Need to find and delete from coordinates map too
            const block = Block.decode(
                blockConfirmation.signedBlock.encodedBlock
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
        const blockConfirmation = this.coordinatesToBlockMap.get(coordinateKey);
        if (!blockConfirmation) return false;

        // Need to find and delete from hash map too
        const blockHash = ethers.keccak256(
            blockConfirmation.signedBlock.encodedBlock
        );

        this.coordinatesToBlockMap.delete(coordinateKey);
        this.hashToBlockMap.delete(blockHash);
        return true;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private coordinatesToKey(coordinates: BlockCoordinates): CoordinateKey {
        return `${coordinates.forkId}:${coordinates.height}`;
    }

    private _storeBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Hash {
        const blockHash = ethers.keccak256(
            blockConfirmation.signedBlock.encodedBlock
        );
        const block = Block.decode(blockConfirmation.signedBlock.encodedBlock);

        return this._storeBlockConfirmationWithKeys(
            blockConfirmation,
            blockHash,
            block.coordinates
        );
    }

    private _storeBlockConfirmationWithKeys(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: Hash,
        coordinates: BlockCoordinates
    ): Hash {
        const coordinateKey = this.coordinatesToKey(coordinates);

        // Check for duplicates - throw if exists
        if (this.hashToBlockMap.has(blockHash)) {
            throw new Error(`Block with hash ${blockHash} already exists`);
        }
        if (this.coordinatesToBlockMap.has(coordinateKey)) {
            throw new Error(
                `Block at fork ${coordinates.forkId}, height ${coordinates.height} already exists`
            );
        }

        this.hashToBlockMap.set(blockHash, blockConfirmation);
        this.coordinatesToBlockMap.set(coordinateKey, blockConfirmation);
        return blockHash;
    }
}
