import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type } from "@/utils";
import { MessageBlockStruct } from "@/index";

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
        it("stores block with computed hash", () => {
            const hash = storage.store(mockExitBlock);
            expect(hash).to.equal(mockBlockHash);
            expect(storage.getMessageBlock(hash)).to.equal(mockExitBlock);
        });

        it("accepts provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.store(mockExitBlock, { hash: customHash });
            expect(hash).to.equal(customHash);
        });

        it("ignores duplicate stores", () => {
            const hash1 = storage.store(mockExitBlock);
            const hash2 = storage.store(mockExitBlock);
            expect(hash1).to.equal(hash2);
        });
    });

    describe("read operations", () => {
        beforeEach(() => {
            storage.store(mockExitBlock);
        });

        it("returns undefined for unknown hashes", () => {
            const randomHash = ethers.hexlify(ethers.randomBytes(32)) as Hash;
            expect(storage.getEntry(randomHash)).to.be.undefined;
        });

        it("retrieves entry by hash", () => {
            const entry = storage.getEntry(mockBlockHash);
            expect(entry?.messageBlock).to.equal(mockExitBlock);
        });

        it("returns ordered entries when iterating by range", () => {
            const nextBlock = {
                ...mockExitBlock,
                previousBlockHash: mockBlockHash,
                blockHeight: 1n
            };
            const nextHash = storage.store(nextBlock);

            const entries = storage.getEntriesInRange(
                nextHash,
                mockExitBlock.previousBlockHash as Hash
            );
            expect(entries).to.have.length(2);
            expect(entries[1].messageBlock).to.deep.equal(nextBlock);
        });
    });

    describe("latest block helpers", () => {
        it("returns the most recent entry", () => {
            const baseHash = storage.store(mockExitBlock);

            const newerBlock = {
                ...mockExitBlock,
                previousBlockHash: baseHash,
                blockHeight: 2n
            };
            storage.store(newerBlock);

            const latestEntry = storage.getLatestEntry();
            expect(latestEntry?.messageBlock).to.deep.equal(newerBlock);

            const latestEntries = storage.getLatestEntries(1);
            expect(latestEntries).to.have.length(1);
            expect(latestEntries[0].messageBlock).to.deep.equal(newerBlock);
        });

        it("returns entries sorted from newest to oldest when no limit is provided", () => {
            storage.store(mockExitBlock);
            const followingBlock = {
                ...mockExitBlock,
                previousBlockHash: mockBlockHash,
                blockHeight: 1n
            };
            storage.store(followingBlock);

            const heights = storage
                .getLatestEntries()
                .map((entry) => entry.messageBlock.blockHeight);
            expect(heights).to.deep.equal([1n, 0n]);
        });
    });
});
