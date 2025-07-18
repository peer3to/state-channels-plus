import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { BlockStorage } from "@/storage/BlockStorage";
import Storage, { SortOrder } from "@/storage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight } from "@/types/types";
import * as factory from "../factory";
import { Block } from "@/models";
import { Codec, Type } from "@/utils";

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
            const stored = storage.getBlockEntry(hash!);
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

            const stored = storage.getBlockEntry(hash1!);

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

            const stored = storage.getBlockEntry(hash!);
            expect(stored?.blockConfirmation).to.equal(mockBlockConfirmation);
        });

        it("should insert block confirmation with provided keys", () => {
            const hash = storage.storeBlockConfirmation(mockBlockConfirmation, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });

            const stored = storage.getBlockEntry(hash!);
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
        describe("Different blocks with same coordinates", () => {
            it("should return undefined when storing different blocks with same coordinates", () => {
                // Store first block
                const hash1 = storage.storeBlockConfirmation(
                    mockBlockConfirmation
                );

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

describe("ForkIdToMaxHeightMap", () => {
    let storage: BlockStorage;
    let forkId: ForkId;

    beforeEach(() => {
        storage = new BlockStorage();
        forkId = factory.hash();
    });

    // Convenience method to create blocks with specific coordinates
    function createBlockWithCoordinates(
        forkId: ForkId,
        height: BlockHeight
    ): BlockConfirmationStruct {
        const block = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId: forkId,
                    transactionCnt: height
                })
            })
        });

        const signedBlock = factory.signedBlock({
            encodedBlock: Codec.encode(block, Type.Block)
        });

        return factory.blockConfirmation({
            signedBlock: signedBlock
        });
    }

    describe("ADDING - Max Height Updates", () => {
        it("should update max height when adding block with higher height", () => {
            // Add block at height 5
            const blockConfirmation1 = createBlockWithCoordinates(forkId, 5);
            storage.storeBlockConfirmation(blockConfirmation1);

            let heighestBlock = storage
                .getBlocksByForkId(forkId, SortOrder.DESC)
                .next().value!;
            let heighestBlockData = Block.decode(
                heighestBlock.blockConfirmation.signedBlock.encodedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(5);

            // Add block at height 10
            const blockConfirmation2 = createBlockWithCoordinates(forkId, 10);
            storage.storeBlockConfirmation(blockConfirmation2);

            heighestBlock = storage
                .getBlocksByForkId(forkId, SortOrder.DESC)
                .next().value!;
            heighestBlockData = Block.decode(
                heighestBlock.blockConfirmation.signedBlock.encodedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(10);
        });

        it("should not update max height when adding block with lower height", () => {
            // Add block at height 10 first
            storage.storeBlockConfirmation(
                createBlockWithCoordinates(forkId, 10)
            );

            // Add block at height 5
            storage.storeBlockConfirmation(
                createBlockWithCoordinates(forkId, 5)
            );

            const blocks = Array.from(
                storage.getBlocksByForkId(forkId, SortOrder.DESC)
            );

            // The first block should be at height 10
            // this means that the max height stored is 10 => not reduced by the new block at height 5
            const firstBlockData = Block.decode(
                blocks[0].blockConfirmation.signedBlock.encodedBlock
            );
            expect(firstBlockData.coordinates.height).to.equal(10);

            // The second block should be at height 5
            const secondBlockData = Block.decode(
                blocks[1].blockConfirmation.signedBlock.encodedBlock
            );
            expect(secondBlockData.coordinates.height).to.equal(5);
        });

        it("should handle multiple forks independently", () => {
            const forkId1 = factory.hash();
            const forkId2 = factory.hash();

            // Add blocks to different forks
            const blockConfirmation1 = createBlockWithCoordinates(forkId1, 10);
            storage.storeBlockConfirmation(blockConfirmation1);

            const blockConfirmation2 = createBlockWithCoordinates(forkId2, 5);
            storage.storeBlockConfirmation(blockConfirmation2);

            // Verify each fork has correct blocks
            const blocks1 = Array.from(storage.getBlocksByForkId(forkId1));
            const blocks2 = Array.from(storage.getBlocksByForkId(forkId2));
            expect(blocks1).to.have.lengthOf(1);
            expect(blocks2).to.have.lengthOf(1);
        });
    });

    describe("REMOVING - Max Height Updates", () => {
        it("should update max height when removing the highest block", () => {
            // Add blocks at heights 0, 5, 10
            for (let height of [0, 5, 10]) {
                const blockConfirmation = createBlockWithCoordinates(
                    forkId,
                    height
                );
                storage.storeBlockConfirmation(blockConfirmation);
            }

            // Remove block at height 10 (highest)
            storage.deleteBlock(forkId, 10);

            // Verify only 2 blocks remain
            const blocks = Array.from(
                storage.getBlocksByForkId(forkId, SortOrder.DESC)
            );
            expect(
                Block.decode(
                    blocks[0].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(5);
            expect(
                Block.decode(
                    blocks[1].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(0);
        });

        it("should not update max height when removing non-highest block", () => {
            // Add blocks at heights 0, 5, 10
            for (let height of [0, 5, 10]) {
                const blockConfirmation = createBlockWithCoordinates(
                    forkId,
                    height
                );
                storage.storeBlockConfirmation(blockConfirmation);
            }

            // Remove block at height 5 (not highest)
            storage.deleteBlock(forkId, 5);

            // Verify only 2 blocks remain
            const blocks = Array.from(
                storage.getBlocksByForkId(forkId, SortOrder.DESC)
            );
            expect(
                Block.decode(
                    blocks[0].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(10);
            expect(
                Block.decode(
                    blocks[1].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(0);
        });

        it("should handle removing the only block in a fork", () => {
            // Add single block at height 5
            const blockConfirmation = createBlockWithCoordinates(forkId, 5);
            storage.storeBlockConfirmation(blockConfirmation);

            // Remove the block
            storage.deleteBlock(forkId, 5);

            // Verify no blocks remain
            expect(storage.getBlocksByForkId(forkId).next().value).to.be
                .undefined;
        });
    });

    describe("GETTING - getBlocksByForkId", () => {
        it("should return empty when no blocks exist on fork", () => {
            const block = storage.getBlocksByForkId(forkId).next().value;
            expect(block).to.be.undefined;
        });

        it("should return blocks in correct order", () => {
            // Add blocks in random order
            for (let height of [10, 0, 5]) {
                const blockConfirmation = createBlockWithCoordinates(
                    forkId,
                    height
                );
                storage.storeBlockConfirmation(blockConfirmation);
            }

            // Test ascending order
            const blocksAsc = Array.from(
                storage.getBlocksByForkId(forkId, SortOrder.ASC)
            );
            expect(
                Block.decode(
                    blocksAsc[0].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(0);
            expect(
                Block.decode(
                    blocksAsc[1].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(5);
            expect(
                Block.decode(
                    blocksAsc[2].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(10);

            // Test descending order
            const blocksDesc = Array.from(
                storage.getBlocksByForkId(forkId, SortOrder.DESC)
            );
            expect(
                Block.decode(
                    blocksDesc[0].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(10);
            expect(
                Block.decode(
                    blocksDesc[1].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(5);
            expect(
                Block.decode(
                    blocksDesc[2].blockConfirmation.signedBlock.encodedBlock
                ).coordinates.height
            ).to.equal(0);
        });
    });
});
