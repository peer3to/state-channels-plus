import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type } from "@/utils";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
describe("MessageBlockStorage - outbound behavior", () => {
    let storage: MessageBlockStorage;
    let mockExitBlock: MessageBlockStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new MessageBlockStorage();
        const baseBlock = factory.exitChannelBlock();
        mockExitBlock = {
            ...baseBlock,
            previousBlockHash: ethers.ZeroHash,
            blockHeight: 0n
        };
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockExitBlock, Type.MessageBlock)
        );
    });

    describe("store()", () => {
        it("stores block with computed hash", async () => {
            const hash = storage.store(mockExitBlock);
            expect(hash).to.equal(mockBlockHash);
            expect(storage.getMessageBlock(hash)).to.deep.equal(mockExitBlock);
        });

        it("accepts provided hash", async () => {
            const customHash = factory.hash();
            const hash = storage.store(mockExitBlock, {
                hash: customHash
            });
            expect(hash).to.equal(customHash);
        });

        it("ignores duplicate stores", async () => {
            const hash1 = storage.store(mockExitBlock);
            const hash2 = storage.store(mockExitBlock);
            expect(hash1).to.equal(hash2);
        });
    });

    describe("read operations", () => {
        beforeEach(async () => {
            storage.store(mockExitBlock);
        });

        it("returns undefined for unknown hashes", async () => {
            const randomHash = factory.hash();
            expect(storage.getMessageBlock(randomHash)).to.be.undefined;
        });

        it("retrieves block by hash", async () => {
            const block = storage.getMessageBlock(mockBlockHash);
            expect(block).to.deep.equal(mockExitBlock);
        });

        it("returns ordered message blocks when iterating by range", async () => {
            const nextBlock = {
                ...mockExitBlock,
                previousBlockHash: mockBlockHash,
                blockHeight: 1n
            };
            const nextHash = storage.store(nextBlock);

            const blocks = storage.getMessageBlocksInRange({
                upperBlockHash: nextHash,
                lowerBlockHash: mockExitBlock.previousBlockHash as Hash
            });
            expect(blocks).to.have.length(2);
            expect(blocks[1]).to.deep.equal(nextBlock);
        });
    });

    describe("latest block helpers", () => {
        it("returns the most recent block", async () => {
            const baseHash = storage.store(mockExitBlock);

            const newerBlock = {
                ...mockExitBlock,
                previousBlockHash: baseHash,
                blockHeight: 2n
            };
            storage.store(newerBlock);

            const latestBlock = storage.getLatestMessageBlock();
            expect(latestBlock).to.deep.equal(newerBlock);

            const latestBlocks = storage.getLatestMessageBlocks(1);
            expect(latestBlocks).to.have.length(1);
            expect(latestBlocks[0]).to.deep.equal(newerBlock);
        });

        it("returns blocks sorted from newest to oldest when no limit is provided", async () => {
            storage.store(mockExitBlock);
            const followingBlock = {
                ...mockExitBlock,
                previousBlockHash: mockBlockHash,
                blockHeight: 1n
            };
            storage.store(followingBlock);

            const heights = storage
                .getLatestMessageBlocks()
                .map((block) => block.blockHeight);
            expect(heights).to.deep.equal([1n, 0n]);
        });
    });
});
