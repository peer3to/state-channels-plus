import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { BlockStorage } from "@/storage/BlockStorage";
import { Storage } from "@/storage/Storage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight } from "@/types/types";
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
            const hash = storage.storeBlock(mockSignedBlock);

            expect(hash).to.equal(mockBlockHash);
            const stored = storage.getBlockEntry(hash);
            expect(stored?.blockConfirmation.signedBlock).to.equal(
                mockSignedBlock
            );
            expect(stored?.blockConfirmation.signatures).to.deep.equal([]);
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
                firstBlockConfirmation
            );

            // Second block confirmation with same shared signature + different unique signature
            const secondBlockConfirmation = {
                ...mockBlockConfirmation,
                signatures: [sharedSignature, uniqueSignature2]
            };

            const hash2 = storage.storeBlockConfirmation(
                secondBlockConfirmation,
                { hash: mockBlockHash }
            );

            // Should return same hash
            expect(hash1).to.equal(hash2);

            const stored = storage.getBlockEntry(hash1);

            // Should have 3 unique signatures (shared signature not duplicated)
            expect(stored?.blockConfirmation.signatures).to.have.lengthOf(3);
            expect(stored?.blockConfirmation.signatures).to.include.members([
                sharedSignature,
                uniqueSignature1,
                uniqueSignature2
            ]);

            // Verify no duplicates
            const signatureSet = new Set(stored?.blockConfirmation.signatures);
            expect(signatureSet.size).to.equal(
                stored?.blockConfirmation.signatures.length
            );
        });

        it("should insert block confirmation with auto-computed keys", () => {
            const hash = storage.storeBlockConfirmation(mockBlockConfirmation);

            const stored = storage.getBlockEntry(hash);
            expect(stored?.blockConfirmation).to.equal(mockBlockConfirmation);
        });

        it("should insert block confirmation with provided keys", () => {
            const hash = storage.storeBlockConfirmation(mockBlockConfirmation, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });

            const stored = storage.getBlockEntry(hash);
            const stored_by_coords = storage.getBlockEntry(
                mockForkId,
                mockHeight
            );
            expect(stored?.blockConfirmation).to.equal(mockBlockConfirmation);
            expect(stored_by_coords?.blockConfirmation).to.equal(
                mockBlockConfirmation
            );
        });
    });

    describe("READ - getBlockEntry()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(mockBlockConfirmation, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should get block by hash", () => {
            const result = storage.getBlockEntry(mockBlockHash);
            expect(result?.blockConfirmation).to.equal(mockBlockConfirmation);
        });

        it("should get block by coordinates", () => {
            const result = storage.getBlockEntry(mockForkId, mockHeight);
            expect(result?.blockConfirmation).to.equal(mockBlockConfirmation);
        });

        it("should return undefined for non-existent blocks", () => {
            expect(
                storage.getBlockEntry(ethers.hexlify(ethers.randomBytes(32)))
            ).to.be.undefined;
            expect(storage.getBlockEntry("nonexistent", 999)).to.be.undefined;
        });

        it("should maintain consistency between lookups", () => {
            const byHash = storage.getBlockEntry(mockBlockHash);
            const byCoords = storage.getBlockEntry(mockForkId, mockHeight);
            expect(byHash?.blockConfirmation).to.equal(
                byCoords?.blockConfirmation
            ); // Same object reference
        });
    });

    describe("UPDATE - insertSignature()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(mockBlockConfirmation, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
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
            const block = storage.getBlockEntry(mockForkId, mockHeight);
            expect(block?.blockConfirmation.signatures).to.include(newSig);
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
                storage.getBlockEntry(mockBlockHash)?.blockConfirmation
                    .signatures
            ).to.have.lengthOf(prevNumSignatures);

            // Insert three different signatures
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);

            expect(
                storage.getBlockEntry(mockBlockHash)?.blockConfirmation
                    .signatures
            ).to.have.lengthOf(expectedNumSignatures);
        });
    });

    describe("UPDATE - setOnChainTimestamp()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(mockBlockConfirmation, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should set on-chain timestamp by hash", () => {
            const timestamp = 1234567890;
            const result = storage.setOnChainTimestamp(
                mockBlockHash,
                timestamp
            );

            expect(result).to.be.true;
            expect(
                storage.getBlockEntry(mockBlockHash)?.onChainTimestamp
            ).to.equal(timestamp);
        });

        it("should set on-chain timestamp by coordinates", () => {
            const timestamp = 1234567890;
            const result = storage.setOnChainTimestamp(
                mockForkId,
                mockHeight,
                timestamp
            );

            expect(result).to.be.true;
            expect(
                storage.getBlockEntry(mockForkId, mockHeight)?.onChainTimestamp
            ).to.equal(timestamp);
        });

        it("should return false for non-existent blocks", () => {
            const timestamp = 1234567890;
            expect(storage.setOnChainTimestamp("nonexistent", timestamp)).to.be
                .false;
            expect(storage.setOnChainTimestamp("nonexistent", 999, timestamp))
                .to.be.false;
        });

        it("should maintain consistency between lookups", () => {
            const timestamp = 1234567890;

            // Set via hash
            storage.setOnChainTimestamp(mockBlockHash, timestamp);

            // Verify via coordinates
            const block = storage.getBlockEntry(mockForkId, mockHeight);
            expect(block?.onChainTimestamp).to.equal(timestamp);
        });
    });

    describe("DELETE - deleteBlock()", () => {
        beforeEach(() => {
            storage.storeBlockConfirmation(mockBlockConfirmation);
        });

        it("should delete by hash", () => {
            expect(storage.deleteBlock(mockBlockHash)).to.be.true;
            expect(storage.getBlockEntry(mockBlockHash)).to.be.undefined;
            expect(storage.getBlockEntry(mockForkId, mockHeight)).to.be
                .undefined;
        });

        it("should delete by coordinates", () => {
            expect(storage.deleteBlock(mockForkId, mockHeight)).to.be.true;
            expect(storage.getBlockEntry(mockBlockHash)).to.be.undefined;
            expect(storage.getBlockEntry(mockForkId, mockHeight)).to.be
                .undefined;
        });

        it("should return false when deleting non-existent blocks", () => {
            expect(storage.deleteBlock("nonexistent")).to.be.false;
            expect(storage.deleteBlock("nonexistent", 999)).to.be.false;
        });
    });

    describe("DeepCopyProxy - Reference Isolation", () => {
        let storageWithProxy: Storage;

        beforeEach(() => {
            storageWithProxy = new Storage();
        });

        it("altering object inside storage (adding signatures) doesn't affect original object", () => {
            // Create a blockConfirmation with initial signatures
            const originalBlockConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig(), sig()]
            });
            const originalSignatureCount =
                originalBlockConfirmation.signatures.length;

            // Store the first blockConfirmation
            const hash1 = storageWithProxy.blocks.storeBlockConfirmation(
                originalBlockConfirmation
            );

            // Create another blockConfirmation with additional signatures (same hash)
            const secondBlockConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig()]
            });

            // Store the second blockConfirmation - this should merge signatures in storage
            const hash2 = storageWithProxy.blocks.storeBlockConfirmation(
                secondBlockConfirmation,
                { hash: hash1 }
            );

            expect(hash1).to.equal(hash2);

            // The original blockConfirmation object should NOT be affected
            expect(originalBlockConfirmation.signatures).to.have.lengthOf(
                originalSignatureCount
            );

            // But the stored blockConfirmation should have merged signatures
            const storedBlock =
                storageWithProxy.blocks.getBlockEntry(mockBlockHash);
            expect(
                storedBlock?.blockConfirmation.signatures.length
            ).to.be.greaterThan(originalSignatureCount);
        });

        it("altering object outside storage doesn't affect object inside storage", () => {
            // Store a blockConfirmation
            const originalBlockConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig()]
            });

            storageWithProxy.blocks.storeBlockConfirmation(
                originalBlockConfirmation,
                { hash: mockBlockHash }
            );

            // Read the blockConfirmation from storage
            const retrievedBlock1 =
                storageWithProxy.blocks.getBlockEntry(mockBlockHash);
            const originalStoredSignatureCount =
                retrievedBlock1?.blockConfirmation.signatures.length || 0;

            // Modify the retrieved object
            retrievedBlock1?.blockConfirmation.signatures.push(sig());
            retrievedBlock1?.blockConfirmation.signatures.push(sig());

            // Read again from storage
            const retrievedBlock2 =
                storageWithProxy.blocks.getBlockEntry(mockBlockHash);

            // The storage should not have been affected by our modifications
            expect(
                retrievedBlock2?.blockConfirmation.signatures
            ).to.have.lengthOf(originalStoredSignatureCount);
            expect(retrievedBlock1).to.not.equal(retrievedBlock2);
        });
    });

    describe("CONFLICT DETECTION - _storeBlockEntryWithOptions()", () => {
        });

        describe("Different blocks with same coordinates", () => {
            it("should return undefined when storing different blocks with same coordinates", () => {
                // Store first block
                const hash1 = storage.storeBlockConfirmation(
                    mockBlockConfirmation
                );
                expect(hash1).to.equal(mockBlockHash);

                // Create different block with same coordinates
                const differentBlock = factory.signedBlock();
                const differentBlockConfirmation = factory.blockConfirmation({
                    signedBlock: differentBlock
                });

                // Try to store with same coordinates but different hash
                const result = storage.storeBlockConfirmation(
                    differentBlockConfirmation,
                    {
                        coordinates: { forkId: mockForkId, height: mockHeight }
                    }
                );

                expect(result).to.be.undefined;
            });

            it("should not store conflicting block in coordinates map", () => {
                // Store first block
                storage.storeBlockConfirmation(mockBlockConfirmation);

                // Create different block with same coordinates
                const differentBlock = factory.signedBlock();
                const differentBlockConfirmation = factory.blockConfirmation({
                    signedBlock: differentBlock
                });

                // Try to store with same coordinates
                storage.storeBlockConfirmation(differentBlockConfirmation, {
                    coordinates: { forkId: mockForkId, height: mockHeight }
                });

                // Should still have original block at those coordinates
                const stored = storage.getBlockEntry(mockForkId, mockHeight);
                expect(stored?.blockConfirmation).to.equal(
                    mockBlockConfirmation
                );
            });
        });

        describe("Different blocks with same hash but different coordinates", () => {
            it("should return hash when storing block with same hash but different coordinates", () => {
                // Store first block
                const hash1 = storage.storeBlockConfirmation(
                    mockBlockConfirmation
                );
                expect(hash1).to.equal(mockBlockHash);

                // Create block with same hash but different coordinates
                const differentCoordinates = {
                    forkId: "different",
                    height: 999
                };
                const result = storage.storeBlockConfirmation(
                    mockBlockConfirmation,
                    {
                        coordinates: differentCoordinates
                    }
                );

                expect(result).to.equal(mockBlockHash);
            });
        });


        describe("Reference equality", () => {
            it("should maintain reference equality between hash and coordinates maps", () => {
                // Store a block
                const hash = storage.storeBlockConfirmation(
                    mockBlockConfirmation
                );
                expect(hash).to.equal(mockBlockHash);

                // Get the block by coordinates
                const blockByCoords = storage.getBlockEntry(
                    mockForkId,
                    mockHeight
                );
                expect(blockByCoords?.blockConfirmation).to.equal(
                    mockBlockConfirmation
                );

                // Change the block by coordinates (add signature)
                const newSignature = sig();
                storage.insertSignature(newSignature, mockForkId, mockHeight);

                // Get that block by hash
                const blockByHash = storage.getBlockEntry(hash!);

                // Assert that the changes are also applied on the by-hash block
                expect(blockByHash?.blockConfirmation.signatures).to.include(
                    newSignature
                );
                expect(blockByCoords?.blockConfirmation.signatures).to.include(
                    newSignature
                );

                // Verify they are the same object reference
                expect(blockByHash).to.equal(blockByCoords);
            });
        });
    });
});
