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
    let mockBlock: Block;
    let mockBlockHash: Hash;
    let mockForkId: ForkId;
    let mockHeight: BlockHeight;

    beforeEach(() => {
        storage = new BlockStorage();

        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });
        mockBlock = Block.fromBlockConfirmation(mockBlockConfirmation);
        mockBlockHash = mockBlock.hash;

        const { forkId, height } = mockBlock.coordinates;
        mockForkId = forkId;
        mockHeight = height;
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

            const hash1 = storage.storeBlock(
                Block.fromBlockConfirmation(firstBlockConfirmation)
            );

            // Second block confirmation with same shared signature + different unique signature
            const secondBlockConfirmation = {
                ...mockBlockConfirmation,
                signatures: [sharedSignature, uniqueSignature2]
            };

            const hash2 = storage.storeBlock(
                Block.fromBlockConfirmation(secondBlockConfirmation),
                { hash: mockBlockHash }
            );

            // Should return same hash
            expect(hash1).to.equal(hash2);

            const stored = storage.getBlockEntry(hash1!);

            // Should have 3 unique signatures (shared signature not duplicated)
            expect(stored?.block.confirmationSignatures.size).to.equal(3);
            expect(stored?.block.confirmationSignatures).to.deep.equal(
                new Set([sharedSignature, uniqueSignature1, uniqueSignature2])
            );
        });

        it("should insert block confirmation with auto-computed keys", () => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            const hash = storage.storeBlock(block);

            const stored = storage.getBlockEntry(hash!);
            expect(stored?.block).to.equal(block);
        });

        it("should insert block confirmation with provided keys", () => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            const hash = storage.storeBlock(block, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });

            const stored = storage.getBlockEntry(hash!);
            const storedByCoords = storage.getBlockEntry(
                mockForkId,
                mockHeight
            );
            expect(stored?.block).to.equal(block);
            expect(storedByCoords?.block).to.equal(block);
        });
    });

    describe("READ - getBlockEntry()", () => {
        beforeEach(() => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            storage.storeBlock(block, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should get block by hash", () => {
            const result = storage.getBlockEntry(mockBlockHash);
            expect(result?.block.equals(mockBlock)).to.be.true;
        });

        it("should get block by coordinates", () => {
            const result = storage.getBlockEntry(mockForkId, mockHeight);
            expect(result?.block.equals(mockBlock)).to.be.true;
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
            expect(byHash?.block).to.equal(byCoords?.block); // Same object reference
        });
    });

    describe("UPDATE - insertSignature()", () => {
        beforeEach(() => {
            storage.storeBlock(mockBlock, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should insert signature by hash", () => {
            const newSig = sig();
            const result = storage.insertSignature(newSig, mockBlockHash);

            expect(result).to.exist;
            expect(result?.allSignatures.has(newSig)).to.be.true;
        });

        it("should insert signature by coordinates", () => {
            const newSig = sig();
            const result = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );

            expect(result).to.exist;
            expect(result?.allSignatures.has(newSig)).to.be.true;
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
            expect(block?.block.allSignatures.has(newSig)).to.be.true;
        });

        it("should prevent duplicate signatures", () => {
            const newSig = sig();
            const prevNumSignatures = mockBlockConfirmation.signatures.length;
            const expectedNumSignatures = prevNumSignatures + 1;

            // Insert signature first time
            const result1 = storage.insertSignature(newSig, mockBlockHash);
            expect(result1?.confirmationSignatures.size).to.equal(
                expectedNumSignatures
            );
            expect(result1?.confirmationSignatures.has(newSig)).to.be.true;

            // Insert same signature again
            const result2 = storage.insertSignature(newSig, mockBlockHash);
            expect(result2?.confirmationSignatures.size).to.equal(
                expectedNumSignatures
            );
            expect(result2?.confirmationSignatures.has(newSig)).to.be.true;
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
            expect(result1?.confirmationSignatures.size).to.equal(
                expectedNumSignatures
            );
            expect(result1?.confirmationSignatures.has(newSig)).to.be.true;

            // Insert same signature again
            const result2 = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );
            expect(result2?.confirmationSignatures.size).to.equal(
                expectedNumSignatures
            );
            expect(result2?.confirmationSignatures.has(newSig)).to.be.true;
        });

        it("should allow multiple unique signatures", () => {
            const prevNumSignatures = mockBlockConfirmation.signatures.length;
            const expectedNumSignatures = prevNumSignatures + 3;
            expect(
                storage.getBlockEntry(mockBlockHash)?.block
                    .confirmationSignatures.size
            ).to.equal(prevNumSignatures);

            // Insert three different signatures
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);

            expect(
                storage.getBlockEntry(mockBlockHash)?.block
                    .confirmationSignatures.size
            ).to.equal(expectedNumSignatures);
        });
    });

    describe("UPDATE - setOnChainTimestamp()", () => {
        beforeEach(() => {
            storage.storeBlock(mockBlock, {
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
            storage.storeBlock(mockBlock);
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
            const hash1 = storageWithProxy.blocks.storeBlock(
                Block.fromBlockConfirmation(originalBlockConfirmation)
            );

            // Create another blockConfirmation with additional signatures (same hash)
            const secondBlockConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig()]
            });

            // Store the second blockConfirmation - this should merge signatures in storage
            const hash2 = storageWithProxy.blocks.storeBlock(
                Block.fromBlockConfirmation(secondBlockConfirmation),
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
                storedBlock?.block.confirmationSignatures.size
            ).to.be.greaterThan(originalSignatureCount);
        });

        it("altering object outside storage doesn't affect object inside storage", () => {
            // Store a blockConfirmation
            const originalBlockConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig()]
            });

            storageWithProxy.blocks.storeBlock(
                Block.fromBlockConfirmation(originalBlockConfirmation),
                { hash: mockBlockHash }
            );

            // Read the blockConfirmation from storage
            const retrievedBlock1 =
                storageWithProxy.blocks.getBlockEntry(mockBlockHash);
            const originalStoredSignatureCount =
                retrievedBlock1?.block.confirmationSignatures.size || 0;

            // Modify the retrieved object
            retrievedBlock1?.block.expandSignatures([sig(), sig()]);

            // Read again from storage
            const retrievedBlock2 =
                storageWithProxy.blocks.getBlockEntry(mockBlockHash);

            // The storage should not have been affected by our modifications
            expect(retrievedBlock2?.block.confirmationSignatures.size).to.equal(
                originalStoredSignatureCount
            );
            expect(retrievedBlock1).to.not.equal(retrievedBlock2);
        });
    });

    describe("CONFLICT DETECTION - _storeBlockEntryWithOptions()", () => {
        describe("Different blocks with same coordinates", () => {
            it("should return undefined when storing different blocks with same coordinates", () => {
                // Store first block
                storage.storeBlock(
                    Block.fromBlockConfirmation(mockBlockConfirmation)
                );

                // Create different block with same coordinates
                const differentBlock = factory.signedBlock();
                const differentBlockConfirmation = factory.blockConfirmation({
                    signedBlock: differentBlock
                });

                // Try to store with same coordinates but different hash
                const result = storage.storeBlock(
                    Block.fromBlockConfirmation(differentBlockConfirmation),
                    {
                        coordinates: { forkId: mockForkId, height: mockHeight }
                    }
                );

                expect(result).to.be.undefined;
            });

            it("should not store conflicting block in coordinates map", () => {
                // Store first block
                storage.storeBlock(mockBlock);

                // Create different block with same coordinates
                const differentBlock = factory.signedBlock();
                const differentBlockConfirmation = factory.blockConfirmation({
                    signedBlock: differentBlock
                });

                // Try to store with same coordinates
                storage.storeBlock(
                    Block.fromBlockConfirmation(differentBlockConfirmation),
                    {
                        coordinates: { forkId: mockForkId, height: mockHeight }
                    }
                );

                // Should still have original block at those coordinates
                const stored = storage.getBlockEntry(mockForkId, mockHeight);
                expect(stored?.block.equals(mockBlock)).to.be.true;
            });
        });

        describe("Different blocks with same hash but different coordinates", () => {
            it("should return hash when storing block with same hash but different coordinates", () => {
                // Store first block
                const hash1 = storage.storeBlock(
                    Block.fromBlockConfirmation(mockBlockConfirmation)
                );

                // Create block with same hash but different coordinates
                const differentCoordinates = {
                    forkId: "different",
                    height: 999
                };
                const result = storage.storeBlock(
                    Block.fromBlockConfirmation(mockBlockConfirmation),
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
                const hash = storage.storeBlock(
                    Block.fromBlockConfirmation(mockBlockConfirmation)
                );

                // Get the block by coordinates
                const blockByCoords = storage.getBlockEntry(
                    mockForkId,
                    mockHeight
                );
                expect(blockByCoords?.block.equals(mockBlock)).to.be.true;

                // Change the block by coordinates (add signature)
                const newSignature = sig();
                storage.insertSignature(newSignature, mockForkId, mockHeight);

                // Get that block by hash
                const blockByHash = storage.getBlockEntry(hash!);

                // Assert that the changes are also applied on the by-hash block
                expect(
                    blockByHash?.block.confirmationSignatures.has(newSignature)
                ).to.be.true;
                expect(
                    blockByCoords?.block.confirmationSignatures.has(
                        newSignature
                    )
                ).to.be.true;

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
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation1));

            let heighestBlock = storage
                .getIterator(forkId, SortOrder.DESC)
                .next().value!;
            let heighestBlockData = Block.fromSignedBlock(
                heighestBlock.block.signedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(5);

            // Add block at height 10
            const blockConfirmation2 = createBlockWithCoordinates(forkId, 10);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation2));

            heighestBlock = storage
                .getIterator(forkId, SortOrder.DESC)
                .next().value!;
            heighestBlockData = Block.fromSignedBlock(
                heighestBlock.block.signedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(10);
        });

        it("should not update max height when adding block with lower height", () => {
            // Add block at height 10 first
            storage.storeBlock(
                Block.fromBlockConfirmation(
                    createBlockWithCoordinates(forkId, 10)
                )
            );

            // Add block at height 5
            storage.storeBlock(
                Block.fromBlockConfirmation(
                    createBlockWithCoordinates(forkId, 5)
                )
            );

            const blocks = Array.from(
                storage.getIterator(forkId, SortOrder.DESC)
            );

            // The first block should be at height 10
            // this means that the max height stored is 10 => not reduced by the new block at height 5
            const firstBlockData = Block.fromSignedBlock(
                blocks[0].block.signedBlock
            );
            expect(firstBlockData.coordinates.height).to.equal(10);

            // The second block should be at height 5
            const secondBlockData = Block.fromSignedBlock(
                blocks[1].block.signedBlock
            );
            expect(secondBlockData.coordinates.height).to.equal(5);
        });

        it("should handle multiple forks independently", () => {
            const forkId1 = factory.hash();
            const forkId2 = factory.hash();

            // Add blocks to different forks
            const blockConfirmation1 = createBlockWithCoordinates(forkId1, 10);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation1));

            const blockConfirmation2 = createBlockWithCoordinates(forkId2, 5);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation2));

            // Verify each fork has correct blocks
            const blocks1 = Array.from(storage.getIterator(forkId1));
            const blocks2 = Array.from(storage.getIterator(forkId2));
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
                storage.storeBlock(
                    Block.fromBlockConfirmation(blockConfirmation)
                );
            }

            // Remove block at height 10 (highest)
            storage.deleteBlock(forkId, 10);

            // Verify only 2 blocks remain
            const blocks = Array.from(
                storage.getIterator(forkId, SortOrder.DESC)
            );
            expect(
                Block.fromSignedBlock(blocks[0].block.signedBlock).coordinates
                    .height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocks[1].block.signedBlock).coordinates
                    .height
            ).to.equal(0);
        });

        it("should not update max height when removing non-highest block", () => {
            // Add blocks at heights 0, 5, 10
            for (let height of [0, 5, 10]) {
                const blockConfirmation = createBlockWithCoordinates(
                    forkId,
                    height
                );
                storage.storeBlock(
                    Block.fromBlockConfirmation(blockConfirmation)
                );
            }

            // Remove block at height 5 (not highest)
            storage.deleteBlock(forkId, 5);

            // Verify only 2 blocks remain
            const blocks = Array.from(
                storage.getIterator(forkId, SortOrder.DESC)
            );
            expect(
                Block.fromSignedBlock(blocks[0].block.signedBlock).coordinates
                    .height
            ).to.equal(10);
            expect(
                Block.fromSignedBlock(blocks[1].block.signedBlock).coordinates
                    .height
            ).to.equal(0);
        });

        it("should handle removing the only block in a fork", () => {
            // Add single block at height 5
            const blockConfirmation = createBlockWithCoordinates(forkId, 5);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation));

            // Remove the block
            storage.deleteBlock(forkId, 5);

            // Verify no blocks remain
            expect(storage.getIterator(forkId).next().value).to.be.undefined;
        });
    });

    describe("GETTING - getIterator", () => {
        it("should return empty when no blocks exist on fork", () => {
            const block = storage.getIterator(forkId).next().value;
            expect(block).to.be.undefined;
        });

        it("should return blocks in correct order", () => {
            // Add blocks in random order
            for (let height of [10, 0, 5]) {
                const blockConfirmation = createBlockWithCoordinates(
                    forkId,
                    height
                );
                storage.storeBlock(
                    Block.fromBlockConfirmation(blockConfirmation)
                );
            }

            // Test ascending order
            const blocksAsc = Array.from(
                storage.getIterator(forkId, SortOrder.ASC)
            );
            expect(
                Block.fromSignedBlock(blocksAsc[0].block.signedBlock)
                    .coordinates.height
            ).to.equal(0);
            expect(
                Block.fromSignedBlock(blocksAsc[1].block.signedBlock)
                    .coordinates.height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocksAsc[2].block.signedBlock)
                    .coordinates.height
            ).to.equal(10);

            // Test descending order
            const blocksDesc = Array.from(
                storage.getIterator(forkId, SortOrder.DESC)
            );
            expect(
                Block.fromSignedBlock(blocksDesc[0].block.signedBlock)
                    .coordinates.height
            ).to.equal(10);
            expect(
                Block.fromSignedBlock(blocksDesc[1].block.signedBlock)
                    .coordinates.height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocksDesc[2].block.signedBlock)
                    .coordinates.height
            ).to.equal(0);
        });
    });
});
