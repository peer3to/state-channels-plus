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
                upperBlockHash: secondHash,
                lowerBlockHash: mockMessageBlock.previousBlockHash as Hash
            });
            expect(blocks).to.have.length(2);
            expect(blocks[0]).to.deep.equal(mockMessageBlock);
            expect(blocks[1]).to.deep.equal(secondBlock);
        });
    });

    describe("tolerant range reads", () => {
        // a chain 0..3 where block 2 was never stored, so the head sits above a
        // hole - exactly what a missed InboundMessagesProcessed log leaves
        let hash0: Hash;
        let hash1: Hash;
        let hash2: Hash;
        let hash3: Hash;
        let block1: MessageBlockStruct;
        let block2: MessageBlockStruct;
        let block3: MessageBlockStruct;

        beforeEach(() => {
            hash0 = storage.store(mockMessageBlock);
            block1 = {
                ...mockMessageBlock,
                previousBlockHash: hash0,
                blockHeight: 1n
            };
            hash1 = storage.store(block1);
            block2 = {
                ...mockMessageBlock,
                previousBlockHash: hash1,
                blockHeight: 2n
            };
            hash2 = hash(Codec.encode(block2, Type.MessageBlock));
            block3 = {
                ...mockMessageBlock,
                previousBlockHash: hash2,
                blockHeight: 3n
            };
            hash3 = storage.store(block3);
        });

        it("complete range → blocks oldest-first, no missingBlockHash", () => {
            const run = storage.tryGetMessageBlocksInRange({
                upperBlockHash: hash1,
                lowerBlockHash: mockMessageBlock.previousBlockHash as Hash
            });
            expect(run.missingBlockHash).to.be.undefined;
            expect(run.blocks).to.deep.equal([mockMessageBlock, block1]);
        });

        it("gap mid-range → blocks stop at the gap, missingBlockHash is the unheld hash", () => {
            const run = storage.tryGetMessageBlocksInRange({
                upperBlockHash: hash3,
                lowerBlockHash: mockMessageBlock.previousBlockHash as Hash
            });
            expect(run.missingBlockHash).to.equal(hash2);
            // only the part above the hole can be proven
            expect(run.blocks).to.deep.equal([block3]);
        });

        it("unheld upperBlockHash → empty blocks, missingBlockHash is it", () => {
            const run = storage.tryGetMessageBlocksInRange({
                upperBlockHash: hash2,
                lowerBlockHash: hash1
            });
            expect(run.missingBlockHash).to.equal(hash2);
            expect(run.blocks).to.deep.equal([]);
        });

        it("upperBlockHash = ZeroHash → empty run, no gap (honest pre-genesis anchor)", () => {
            const run = storage.tryGetMessageBlocksInRange({
                upperBlockHash: ethers.ZeroHash,
                lowerBlockHash: ethers.ZeroHash
            });
            expect(run.blocks).to.deep.equal([]);
            expect(run.missingBlockHash).to.be.undefined;
        });

        it("empty store → empty run, no gap", () => {
            const empty = new MessageBlockStorage();
            const run = empty.tryGetMessageBlocksInRange();
            expect(run.blocks).to.deep.equal([]);
            expect(run.missingBlockHash).to.be.undefined;
        });

        it("the strict read still throws the same message on that gap", () => {
            expect(() =>
                storage.getMessageBlocksInRange({
                    upperBlockHash: hash3,
                    lowerBlockHash: mockMessageBlock.previousBlockHash as Hash
                })
            ).to.throw(`Block hash ${hash2} not found in storage`);
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
