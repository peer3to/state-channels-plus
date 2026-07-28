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
        it("should merge signatures with deduplication on duplicate insert", async () => {
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

            const stored = storage.getBlock(hash1!);

            // Should have 3 unique signatures (shared signature not duplicated)
            expect(stored?.confirmationSignatures.size).to.equal(3);
            expect(stored?.confirmationSignatures).to.deep.equal(
                new Set([sharedSignature, uniqueSignature1, uniqueSignature2])
            );
        });

        it("should overwrite on-chain timestamp on duplicate insert", async () => {
            storage.storeBlock(
                Block.fromBlockConfirmation(mockBlockConfirmation, 20)
            );

            storage.storeBlock(
                Block.fromBlockConfirmation(mockBlockConfirmation, 30),
                { hash: mockBlockHash }
            );

            expect(storage.getBlock(mockBlockHash)?.onChainTimestamp).to.equal(
                30
            );
        });

        it("should insert block confirmation with auto-computed keys", async () => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            const hash = storage.storeBlock(block);

            const stored = storage.getBlock(hash!);
            expect(stored?.equals(block)).to.be.true;
            expect(stored).to.not.equal(block);
        });

        it("should insert block confirmation with provided keys", async () => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            const hash = storage.storeBlock(block, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });

            const stored = storage.getBlock(hash!);
            const storedByCoords = storage.getBlock(mockForkId, mockHeight);
            expect(stored?.equals(block)).to.be.true;
            expect(storedByCoords?.equals(block)).to.be.true;
            expect(stored).to.not.equal(block);
        });
    });

    describe("READ - getBlockEntry()", () => {
        beforeEach(async () => {
            const block = Block.fromBlockConfirmation(mockBlockConfirmation);
            storage.storeBlock(block, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should get block by hash", async () => {
            const result = storage.getBlock(mockBlockHash);
            expect(result?.equals(mockBlock)).to.be.true;
        });

        it("should get block by coordinates", async () => {
            const result = storage.getBlock(mockForkId, mockHeight);
            expect(result?.equals(mockBlock)).to.be.true;
        });

        it("should return undefined for non-existent blocks", async () => {
            expect(storage.getBlock(ethers.hexlify(ethers.randomBytes(32)))).to
                .be.undefined;
            expect(storage.getBlock("nonexistent", 999)).to.be.undefined;
        });

        it("should maintain consistency between lookups", async () => {
            const byHash = storage.getBlock(mockBlockHash);
            const byCoords = storage.getBlock(mockForkId, mockHeight);
            expect(byHash).to.equal(byCoords); // Same object reference
        });
    });

    describe("UPDATE - insertSignature()", () => {
        beforeEach(async () => {
            storage.storeBlock(mockBlock, {
                coordinates: { forkId: mockForkId, height: mockHeight }
            });
        });

        it("should insert signature by hash", async () => {
            const newSig = sig();
            const result = storage.insertSignature(newSig, mockBlockHash);

            expect(result).to.exist;
            expect(result?.allSignatures.has(newSig)).to.be.true;
        });

        it("should insert signature by coordinates", async () => {
            const newSig = sig();
            const result = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );

            expect(result).to.exist;
            expect(result?.allSignatures.has(newSig)).to.be.true;
        });

        it("should return undefined for non-existent blocks", async () => {
            const newSig = sig();
            expect(storage.insertSignature(newSig, "nonexistent")).to.be
                .undefined;
            expect(storage.insertSignature(newSig, "nonexistent", 999)).to.be
                .undefined;
        });

        it("should modify same object regardless of lookup method", async () => {
            const newSig = sig();

            // Insert via hash
            storage.insertSignature(newSig, mockBlockHash);

            // Verify via coordinates
            const block = storage.getBlock(mockForkId, mockHeight);
            expect(block?.allSignatures.has(newSig)).to.be.true;
        });

        it("should prevent duplicate signatures", async () => {
            const newSig = sig();
            const prevNumSignatures = mockBlock.confirmationSignatures.size;
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

        it("should prevent duplicate signatures by coordinates", async () => {
            const newSig = sig();
            const prevNumSignatures = mockBlock.confirmationSignatures.size;
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

        it("should allow multiple unique signatures", async () => {
            const prevNumSignatures = mockBlock.confirmationSignatures.size;
            const expectedNumSignatures = prevNumSignatures + 3;
            expect(
                storage.getBlock(mockBlockHash)?.confirmationSignatures.size
            ).to.equal(prevNumSignatures);

            // Insert three different signatures
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);
            storage.insertSignature(sig(), mockBlockHash);

            expect(
                storage.getBlock(mockBlockHash)?.confirmationSignatures.size
            ).to.equal(expectedNumSignatures);
        });
    });

    describe("READ - getIterator() DESC clamp", () => {
        it("clamps an absurd startHeight to maxHeight instead of looping the empty range", async () => {
            storage.storeBlock(mockBlock);

            // Without the clamp this would loop from ~9e15 down to 0 and hang
            // the event loop (the remote-sync-height DoS). It must return
            // promptly, yielding only the stored block.
            const collected = [
                ...storage.getIterator(
                    mockForkId,
                    SortOrder.DESC,
                    Number.MAX_SAFE_INTEGER
                )
            ];
            expect(collected.map((b) => b.hash)).to.deep.equal([mockBlockHash]);
        });
    });

    describe("DELETE - deleteBlock()", () => {
        beforeEach(async () => {
            storage.storeBlock(mockBlock);
        });

        it("should delete by hash", async () => {
            expect(storage.deleteBlock(mockBlockHash)).to.be.true;
            expect(storage.getBlock(mockBlockHash)).to.be.undefined;
            expect(storage.getBlock(mockForkId, mockHeight)).to.be.undefined;
        });

        it("should delete by coordinates", async () => {
            expect(storage.deleteBlock(mockForkId, mockHeight)).to.be.true;
            expect(storage.getBlock(mockBlockHash)).to.be.undefined;
            expect(storage.getBlock(mockForkId, mockHeight)).to.be.undefined;
        });

        it("should return false when deleting non-existent blocks", async () => {
            expect(storage.deleteBlock("nonexistent")).to.be.false;
            expect(storage.deleteBlock("nonexistent", 999)).to.be.false;
        });
    });

    describe("DeepCopyProxy - Reference Isolation", () => {
        let storageWithProxy: Storage;

        beforeEach(() => {
            storageWithProxy = new Storage();
        });

        it("altering object inside storage (adding signatures) doesn't affect original object", async () => {
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
            const storedBlock = storageWithProxy.blocks.getBlock(mockBlockHash);
            expect(storedBlock?.confirmationSignatures.size).to.be.greaterThan(
                originalSignatureCount
            );
        });

        it("altering object outside storage doesn't affect object inside storage", async () => {
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
                storageWithProxy.blocks.getBlock(mockBlockHash);
            const originalStoredSignatureCount =
                retrievedBlock1?.confirmationSignatures.size || 0;

            // Modify the retrieved object
            retrievedBlock1?.expandSignatures([sig(), sig()]);

            // Read again from storage
            const retrievedBlock2 =
                storageWithProxy.blocks.getBlock(mockBlockHash);

            // The storage should not have been affected by our modifications
            expect(retrievedBlock2?.confirmationSignatures.size).to.equal(
                originalStoredSignatureCount
            );
            expect(retrievedBlock1).to.not.equal(retrievedBlock2);
        });
    });

    describe("CONFLICT DETECTION - _storeBlockEntryWithOptions()", () => {
        describe("Different blocks with same coordinates", () => {
            it("should return undefined when storing different blocks with same coordinates", async () => {
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

            it("should not store conflicting block in coordinates map", async () => {
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
                const stored = storage.getBlock(mockForkId, mockHeight);
                expect(stored?.equals(mockBlock)).to.be.true;
            });
        });

        describe("Different blocks with same hash but different coordinates", () => {
            it("should reject a stored hash with different coordinates", async () => {
                // Store first block
                storage.storeBlock(
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

                expect(result).to.equal(undefined);
                expect(
                    storage.getBlock(
                        differentCoordinates.forkId,
                        differentCoordinates.height
                    )
                ).to.equal(undefined);
                expect(
                    storage.getBlock(mockBlockHash)?.coordinates
                ).to.deep.equal(mockBlock.coordinates);
            });
        });

        describe("Clone replacement", () => {
            it("should replace the cached block without mutating an earlier read", async () => {
                // Store a block
                const hash = storage.storeBlock(
                    Block.fromBlockConfirmation(mockBlockConfirmation)
                );

                // Get the block by coordinates
                const blockByCoords = storage.getBlock(mockForkId, mockHeight);
                expect(blockByCoords?.equals(mockBlock)).to.be.true;

                // Change the block by coordinates (add signature)
                const newSignature = sig();
                storage.insertSignature(newSignature, mockForkId, mockHeight);

                // Get that block by hash
                const blockByHash = storage.getBlock(hash!);

                // Assert that the changes are also applied on the by-hash block
                expect(blockByHash?.confirmationSignatures.has(newSignature)).to
                    .be.true;
                expect(blockByCoords?.confirmationSignatures.has(newSignature))
                    .to.be.false;

                expect(blockByHash).to.not.equal(blockByCoords);
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

        // `factory.block()` returns a `Block` model (already backed by an encoded `BlockStruct`).
        // Use its confirmation struct directly rather than trying to ABI-encode the class instance.
        return block.blockConfirmationStruct;
    }

    describe("ADDING - Max Height Updates", () => {
        it("should update max height when adding block with higher height", async () => {
            // Add block at height 5
            const blockConfirmation1 = createBlockWithCoordinates(forkId, 5);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation1));

            let heighestBlock = storage
                .getIterator(forkId, SortOrder.DESC)
                .next().value!;
            let heighestBlockData = Block.fromSignedBlock(
                heighestBlock.signedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(5);

            // Add block at height 10
            const blockConfirmation2 = createBlockWithCoordinates(forkId, 10);
            storage.storeBlock(Block.fromBlockConfirmation(blockConfirmation2));

            heighestBlock = storage
                .getIterator(forkId, SortOrder.DESC)
                .next().value!;
            heighestBlockData = Block.fromSignedBlock(
                heighestBlock.signedBlock
            );
            expect(heighestBlockData.coordinates.height).to.equal(10);
        });

        it("should not update max height when adding block with lower height", async () => {
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
            const firstBlockData = Block.fromSignedBlock(blocks[0].signedBlock);
            expect(firstBlockData.coordinates.height).to.equal(10);

            // The second block should be at height 5
            const secondBlockData = Block.fromSignedBlock(
                blocks[1].signedBlock
            );
            expect(secondBlockData.coordinates.height).to.equal(5);
        });

        it("should handle multiple forks independently", async () => {
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
        it("should update max height when removing the highest block", async () => {
            // Add blocks at heights 0, 5, 10
            for (const height of [0, 5, 10]) {
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
                Block.fromSignedBlock(blocks[0].signedBlock).coordinates.height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocks[1].signedBlock).coordinates.height
            ).to.equal(0);
        });

        it("should not update max height when removing non-highest block", async () => {
            // Add blocks at heights 0, 5, 10
            for (const height of [0, 5, 10]) {
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
                Block.fromSignedBlock(blocks[0].signedBlock).coordinates.height
            ).to.equal(10);
            expect(
                Block.fromSignedBlock(blocks[1].signedBlock).coordinates.height
            ).to.equal(0);
        });

        it("should handle removing the only block in a fork", async () => {
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
        it("should return empty when no blocks exist on fork", async () => {
            const block = storage.getIterator(forkId).next().value;
            expect(block).to.be.undefined;
        });

        it("should return blocks in correct order", async () => {
            // Add blocks in random order
            for (const height of [10, 0, 5]) {
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
                Block.fromSignedBlock(blocksAsc[0].signedBlock).coordinates
                    .height
            ).to.equal(0);
            expect(
                Block.fromSignedBlock(blocksAsc[1].signedBlock).coordinates
                    .height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocksAsc[2].signedBlock).coordinates
                    .height
            ).to.equal(10);

            // Test descending order
            const blocksDesc = Array.from(
                storage.getIterator(forkId, SortOrder.DESC)
            );
            expect(
                Block.fromSignedBlock(blocksDesc[0].signedBlock).coordinates
                    .height
            ).to.equal(10);
            expect(
                Block.fromSignedBlock(blocksDesc[1].signedBlock).coordinates
                    .height
            ).to.equal(5);
            expect(
                Block.fromSignedBlock(blocksDesc[2].signedBlock).coordinates
                    .height
            ).to.equal(0);
        });
    });
});
