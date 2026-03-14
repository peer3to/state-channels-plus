import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import * as factory from "../factory";
import { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
describe("MessageBlockStorage - inbound blocks", () => {
    let storage: MessageBlockStorage;
    let mockMessageBlock: MessageBlockStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new MessageBlockStorage();
        mockMessageBlock = {
            previousBlockHash: ethers.ZeroHash,
            blockHeight: 0n,
            messages: [],
            totalBalance: {
                amount: 0n,
                data: "0x"
            },
            timestamp: 0n
        };
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockMessageBlock, Type.MessageBlock)
        );
    });

    describe("store()", () => {
        it("stores block with computed hash", () => {
            const hash = storage.store(mockMessageBlock);
            expect(hash).to.equal(mockBlockHash);

            const storedBlock = storage.getMessageBlock(hash);
            expect(storedBlock).to.equal(mockMessageBlock);
        });

        it("respects provided hash override", () => {
            const customHash = factory.hash();
            const hash = storage.store(mockMessageBlock, {
                hash: customHash
            });

            expect(hash).to.equal(customHash);
            expect(storage.getMessageBlock(customHash)).to.equal(
                mockMessageBlock
            );
        });

        it("ignores metadata on duplicate store", () => {
            const hash1 = storage.store(mockMessageBlock);
            const hash2 = storage.store(mockMessageBlock);
            expect(hash1).to.equal(hash2);
        });
    });

    describe("read operations", () => {
        beforeEach(() => {
            storage.store(mockMessageBlock);
        });

        it("returns undefined for unknown hashes", () => {
            const randomHash = factory.hash();
            expect(storage.getMessageBlock(randomHash)).to.be.undefined;
        });

        it("retrieves ordered entries in range", () => {
            const secondBlock = {
                ...mockMessageBlock,
                previousBlockHash: mockBlockHash,
                blockHeight: 1n
            };
            const secondHash = storage.store(secondBlock);

            const blocks = storage.getMessageBlocksInRange({
                fromBlockHash: secondHash,
                toBlockHash: mockMessageBlock.previousBlockHash as Hash
            });
            expect(blocks).to.have.length(2);
            expect(blocks[0]).to.deep.equal(mockMessageBlock);
            expect(blocks[1]).to.deep.equal(secondBlock);
        });
    });

    describe("latest block helpers", () => {
        it("returns undefined when storage is empty", () => {
            expect(storage.getLatestMessageBlock()).to.be.undefined;
            expect(storage.getLatestMessageBlocks()).to.deep.equal([]);
            expect(storage.getLatestBlockHeight()).to.be.undefined;
        });

        it("tracks the highest block height even when stored out of order", () => {
            const genesisHash = storage.store(mockMessageBlock);

            const middleBlock = {
                ...mockMessageBlock,
                previousBlockHash: genesisHash,
                blockHeight: 3n,
                timestamp: 5n
            };
            const middleHash = hash(
                Codec.encode(middleBlock, Type.MessageBlock)
            );

            const highestBlock = {
                ...mockMessageBlock,
                previousBlockHash: middleHash,
                blockHeight: 5n,
                timestamp: 10n
            };
            const highestHash = storage.store(highestBlock);

            storage.store(middleBlock);

            const latest = storage.getLatestMessageBlock();
            expect(latest).to.deep.equal(highestBlock);
            expect(storage.getLatestBlockHash()).to.equal(highestHash);
            expect(storage.getLatestBlockHeight()).to.equal(5);

            const latestTwo = storage.getLatestMessageBlocks(2);
            expect(latestTwo).to.deep.equal([highestBlock, middleBlock]);
        });
    });
});
