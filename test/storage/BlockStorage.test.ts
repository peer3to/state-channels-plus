import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { BlockStorage } from "@/storage/BlockStorage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight, Signature } from "@/types/types";
import * as factory from "../factory";
import { Block } from "@/models";

const sig = () => ethers.hexlify(ethers.randomBytes(65));

describe("BlockStorage", () => {
    let storage: BlockStorage;
    let mockSignedBlock: SignedBlockStruct;
    let mockBlockConfirmation: BlockConfirmationStruct;
    let mockBlockHash: Hash;
    let mockForkId: ForkId;
    let mockHeight: BlockHeight;

    beforeEach(() => {
        storage = new BlockStorage();

        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });

        const block = Block.decode(mockSignedBlock.encodedBlock);
        mockBlockHash = block.hash;

        const { forkId, height } = block.coordinates;
        mockForkId = forkId;
        mockHeight = height;
    });

    describe("CREATE - storeBlock()", () => {
        it("should store SignedBlock and return same hash with empty signatures", () => {
            const hash = storage.storeBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            expect(hash).to.equal(mockBlockHash);
            const stored = storage.getBlockConfirmation(hash);
            expect(stored?.signedBlock).to.equal(mockSignedBlock);
            expect(stored?.signatures).to.deep.equal([]);
        });
    });

    describe("CREATE - storeBlockConfirmation()", () => {
        it("should merge signatures with deduplication on duplicate insert", () => {
            // Create shared and unique signatures
            const sharedSignature = sig();
            const uniqueSignature1 = sig();
            const uniqueSignature2 = sig();

            // First block confirmation with shared + unique signature
            const firstBlockConfirmation = {
                ...mockBlockConfirmation,
                signatures: [sharedSignature, uniqueSignature1]
            };

            const hash1 = storage.storeBlockConfirmation(
                firstBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Second block confirmation with same shared signature + different unique signature
            const secondBlockConfirmation = {
                ...mockBlockConfirmation,
                signatures: [sharedSignature, uniqueSignature2]
            };

            const hash2 = storage.storeBlockConfirmation(
                secondBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Should return same hash
            expect(hash1).to.equal(hash2);

            const stored = storage.getBlockConfirmation(hash1);

            // Should have 3 unique signatures (shared signature not duplicated)
            expect(stored?.signatures).to.have.lengthOf(3);
            expect(stored?.signatures).to.include.members([
                sharedSignature,
                uniqueSignature1,
                uniqueSignature2
            ]);

            // Verify no duplicates
            const signatureSet = new Set(stored?.signatures);
            expect(signatureSet.size).to.equal(stored?.signatures.length);
        });

        it("should insert block confirmation with auto-computed keys", () => {
            const hash = storage.storeBlockConfirmation(mockBlockConfirmation);

            const stored = storage.getBlockConfirmation(hash);
            expect(stored).to.equal(mockBlockConfirmation);
        });

        it("should insert block confirmation with provided keys", () => {
            const hash = storage.storeBlockConfirmation(
                mockBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            const stored = storage.getBlockConfirmation(hash);
            expect(stored).to.equal(mockBlockConfirmation);
        });
    });

    describe("READ - getBlockConfirmation()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(
                mockBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );
        });

        it("should get block by hash", () => {
            const result = storage.getBlockConfirmation(mockBlockHash);
            expect(result).to.equal(mockBlockConfirmation);
        });

        it("should get block by coordinates", () => {
            const result = storage.getBlockConfirmation(mockForkId, mockHeight);
            expect(result).to.equal(mockBlockConfirmation);
        });

        it("should return undefined for non-existent blocks", () => {
            expect(
                storage.getBlockConfirmation(
                    ethers.hexlify(ethers.randomBytes(32))
                )
            ).to.be.undefined;
            expect(storage.getBlockConfirmation("nonexistent", 999)).to.be
                .undefined;
        });

        it("should maintain consistency between lookups", () => {
            const byHash = storage.getBlockConfirmation(mockBlockHash);
            const byCoords = storage.getBlockConfirmation(
                mockForkId,
                mockHeight
            );
            expect(byHash).to.equal(byCoords); // Same object reference
        });
    });

    describe("UPDATE - insertSignature()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(
                mockBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );
        });

        it("should insert signature by hash", () => {
            const newSig = sig();
            const result = storage.insertSignature(newSig, mockBlockHash);

            expect(result).to.exist;
            expect(result?.signatures).to.include(newSig);
        });

        it("should insert signature by coordinates", () => {
            const newSig = sig();
            const result = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );

            expect(result).to.exist;
            expect(result?.signatures).to.include(newSig);
        });

        it("should return undefined for non-existent blocks", () => {
            const newSig = sig();
            expect(storage.insertSignature(newSig, "nonexistent")).to.be
                .undefined;
            expect(storage.insertSignature(newSig, "nonexistent", 999)).to.be
                .undefined;
        });

        it("should modify same object regardless of lookup method", () => {
            const newSig = sig();

            // Insert via hash
            storage.insertSignature(newSig, mockBlockHash);

            // Verify via coordinates
            const block = storage.getBlockConfirmation(mockForkId, mockHeight);
            expect(block?.signatures).to.include(newSig);
        });

        it("should prevent duplicate signatures", () => {
            const newSig = sig();
            const prevNumSignatures = mockBlockConfirmation.signatures.length;
            const expectedNumSignatures = prevNumSignatures + 1;

            // Insert signature first time
            const result1 = storage.insertSignature(newSig, mockBlockHash);
            expect(result1?.signatures).to.have.lengthOf(expectedNumSignatures);
            expect(result1?.signatures).to.include(newSig);

            // Insert same signature again
            const result2 = storage.insertSignature(newSig, mockBlockHash);
            expect(result2?.signatures).to.have.lengthOf(expectedNumSignatures);
            expect(result2?.signatures).to.include(newSig);
        });

        it("should prevent duplicate signatures by coordinates", () => {
            const newSig = sig();
            const prevNumSignatures = mockBlockConfirmation.signatures.length;
            const expectedNumSignatures = prevNumSignatures + 1;

            // Insert signature first time
            const result1 = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );
            expect(result1?.signatures).to.have.lengthOf(expectedNumSignatures);
            expect(result1?.signatures).to.include(newSig);

            // Insert same signature again
            const result2 = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );
            expect(result2?.signatures).to.have.lengthOf(expectedNumSignatures);
            expect(result2?.signatures).to.include(newSig);
        });

        it("should allow multiple unique signatures", () => {
            const prevNumSignatures = mockBlockConfirmation.signatures.length;
            const expectedNumSignatures = prevNumSignatures + 3;
            expect(
                storage.getBlockConfirmation(mockBlockHash)?.signatures
            ).to.have.lengthOf(prevNumSignatures);

            // Insert three different signatures
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);

            expect(
                storage.getBlockConfirmation(mockBlockHash)?.signatures
            ).to.have.lengthOf(expectedNumSignatures);
        });
    });

    describe("DELETE - deleteBlock()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(
                mockBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );
        });

        it("should delete by hash", () => {
            expect(storage.deleteBlock(mockBlockHash)).to.be.true;
            expect(storage.getBlockConfirmation(mockBlockHash)).to.be.undefined;
            expect(storage.getBlockConfirmation(mockForkId, mockHeight)).to.be
                .undefined;
        });

        it("should delete by coordinates", () => {
            expect(storage.deleteBlock(mockForkId, mockHeight)).to.be.true;
            expect(storage.getBlockConfirmation(mockBlockHash)).to.be.undefined;
            expect(storage.getBlockConfirmation(mockForkId, mockHeight)).to.be
                .undefined;
        });

        it("should return false when deleting non-existent blocks", () => {
            expect(storage.deleteBlock("nonexistent")).to.be.false;
            expect(storage.deleteBlock("nonexistent", 999)).to.be.false;
        });
    });
});
