import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { BlockStorage } from "@/storage/BlockStorage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash, ForkId, BlockHeight, Signature } from "@/types/types";
import * as factory from "../factory";
import { Block } from "@/models";

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
        mockBlockHash = ethers.keccak256(mockSignedBlock.encodedBlock);

        const block = Block.decode(mockSignedBlock.encodedBlock);
        const { forkId, height } = block.coordinates;
        mockForkId = forkId;
        mockHeight = height;
    });

    describe("CREATE - storeBlock()", () => {
        it("should throw on duplicate insert by hash", () => {
            // First insert succeeds
            storage.storeBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Second insert should throw
            expect(() => {
                storage.storeBlock(
                    mockSignedBlock,
                    mockBlockHash,
                    "fork2",
                    100
                );
            }).to.throw(/already exists/);
        });

        it("should throw on duplicate insert by coordinates", () => {
            // First insert succeeds
            storage.storeBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Different hash, same coordinates should throw
            const differentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(() => {
                storage.storeBlock(
                    mockSignedBlock,
                    differentHash,
                    mockForkId,
                    mockHeight
                );
            }).to.throw(/already exists/);
        });

        it("should convert SignedBlock to BlockConfirmation with empty signatures", () => {
            // Insert SignedBlock
            const hash = storage.storeBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Verify conversion
            const stored = storage.getBlockConfirmation(hash);
            expect(stored?.signedBlock).to.equal(mockSignedBlock);
            expect(stored?.signatures).to.deep.equal([]);
        });
    });

    describe("CREATE - insertBlockConfirmation()", () => {
        it("should throw on duplicate insert by hash", () => {
            // First insert succeeds
            storage.storeBlockConfirmation(
                mockBlockConfirmation,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Second insert should throw
            expect(() => {
                storage.storeBlockConfirmation(
                    mockBlockConfirmation,
                    mockBlockHash,
                    "fork2",
                    100
                );
            }).to.throw(/already exists/);
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
            const newSig = ethers.hexlify(ethers.randomBytes(65));
            const result = storage.insertSignature(newSig, mockBlockHash);

            expect(result).to.exist;
            expect(result?.signatures).to.include(newSig);
        });

        it("should insert signature by coordinates", () => {
            const newSig = ethers.hexlify(ethers.randomBytes(65));
            const result = storage.insertSignature(
                newSig,
                mockForkId,
                mockHeight
            );

            expect(result).to.exist;
            expect(result?.signatures).to.include(newSig);
        });

        it("should return undefined for non-existent blocks", () => {
            const newSig = ethers.hexlify(ethers.randomBytes(65));
            expect(storage.insertSignature(newSig, "nonexistent")).to.be
                .undefined;
            expect(storage.insertSignature(newSig, "nonexistent", 999)).to.be
                .undefined;
        });

        it("should modify same object regardless of lookup method", () => {
            const newSig = ethers.hexlify(ethers.randomBytes(65));

            // Insert via hash
            storage.insertSignature(newSig, mockBlockHash);

            // Verify via coordinates
            const block = storage.getBlockConfirmation(mockForkId, mockHeight);
            expect(block?.signatures).to.include(newSig);
        });

        it("should prevent duplicate signatures", () => {
            const newSig = ethers.hexlify(ethers.randomBytes(65));
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
            const newSig = ethers.hexlify(ethers.randomBytes(65));
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
            const sig = () => ethers.hexlify(ethers.randomBytes(65));
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
