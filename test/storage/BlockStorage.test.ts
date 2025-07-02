import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { BlockStorageModule } from "@/storage/BlockStorage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type, BlockUtils } from "@/utils";

describe("BlockStorageModule", () => {
    let storage: BlockStorageModule;
    let mockSignedBlock: SignedBlockStruct;
    let mockBlockConfirmation: BlockConfirmationStruct;
    let mockBlockHash: Hash;
    let mockForkId: string;
    let mockHeight: number;

    beforeEach(() => {
        storage = new BlockStorageModule();

        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });
        mockBlockHash = ethers.keccak256(mockSignedBlock.encodedBlock);

        const block = Codec.decode(mockSignedBlock.encodedBlock, Type.Block);
        const { forkId, height } = BlockUtils.getCoordinates(block);
        mockForkId = forkId;
        mockHeight = height;
    });

    describe("CREATE - insertBlock()", () => {
        it("should throw on duplicate insert by hash", () => {
            // First insert succeeds
            storage.insertBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Second insert should throw
            expect(() => {
                storage.insertBlock(
                    mockSignedBlock,
                    mockBlockHash,
                    "fork2",
                    100
                );
            }).to.throw(/already exists/);
        });

        it("should throw on duplicate insert by coordinates", () => {
            // First insert succeeds
            storage.insertBlock(
                mockSignedBlock,
                mockBlockHash,
                mockForkId,
                mockHeight
            );

            // Different hash, same coordinates should throw
            const differentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(() => {
                storage.insertBlock(
                    mockSignedBlock,
                    differentHash,
                    mockForkId,
                    mockHeight
                );
            }).to.throw(/already exists/);
        });

        it("should convert SignedBlock to BlockConfirmation with empty signatures", () => {
            // Insert SignedBlock
            const hash = storage.insertBlock(
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

    describe("READ - getBlockConfirmation()", () => {
        beforeEach(() => {
            storage.insertBlock(
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
            storage.insertBlock(
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
    });

    describe("DELETE - deleteBlock()", () => {
        beforeEach(() => {
            storage.insertBlock(
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
