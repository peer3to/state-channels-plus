import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { JoinChannelBlockStorage } from "@/storage/JoinChannelBlockStorage";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type } from "@/utils";

describe("JoinChannelBlockStorage", () => {
    let storage: JoinChannelBlockStorage;
    let mockJoinBlock: JoinChannelBlockStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new JoinChannelBlockStorage();
        mockJoinBlock = factory.joinChannelBlock();
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockJoinBlock, Type.JoinChannelBlock)
        );
    });

    describe("CREATE - storeJoinChannelBlock()", () => {
        it("should store block and return hash with auto-computed hash", () => {
            const hash = storage.storeJoinChannelBlock(mockJoinBlock);
            expect(hash).to.equal(mockBlockHash);

            const stored = storage.getJoinChannelBlock(hash);
            expect(stored).to.equal(mockJoinBlock);
        });

        it("should store block with provided hash", () => {
            const fakeHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeJoinChannelBlock(mockJoinBlock, fakeHash);
            expect(hash).to.equal(fakeHash);

            const stored = storage.getJoinChannelBlock(fakeHash);
            expect(stored).to.equal(mockJoinBlock);
        });

        it("should throw on duplicate hash", () => {
            // First store succeeds
            storage.storeJoinChannelBlock(mockJoinBlock, mockBlockHash);

            // Second store with same hash should throw
            expect(() => {
                storage.storeJoinChannelBlock(mockJoinBlock, mockBlockHash);
            }).to.throw(/already exists/);
        });

        it("should update latest block hash", () => {
            const hash = storage.storeJoinChannelBlock(mockJoinBlock);
            expect(storage.getLatestJoinChannelBlockHash()).to.equal(hash);

            // Store another block
            const newBlock = factory.joinChannelBlock();
            const newHash = storage.storeJoinChannelBlock(newBlock);
            expect(storage.getLatestJoinChannelBlockHash()).to.equal(newHash);
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeJoinChannelBlock(mockJoinBlock, mockBlockHash);
        });

        it("should get block by hash", () => {
            const result = storage.getJoinChannelBlock(mockBlockHash);
            expect(result).to.equal(mockJoinBlock);
        });

        it("should return undefined for non-existent block", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getJoinChannelBlock(nonExistentHash)).to.be
                .undefined;
        });

        it("should get latest block", () => {
            expect(storage.getLatestJoinChannelBlock()).to.equal(mockJoinBlock);
        });

        it("should get latest block hash", () => {
            expect(storage.getLatestJoinChannelBlockHash()).to.equal(
                mockBlockHash
            );
        });
    });

    describe("Total Deposits", () => {
        it("should initialize with zero balance", () => {
            expect(storage.getTotalDeposits()).to.deep.equal({
                amount: BigInt(0),
                data: "0x"
            });
        });

        it("should update total deposits", () => {
            const newBalance: BalanceStruct = {
                amount: BigInt(1000),
                data: "0x1234"
            };
            storage.setTotalDeposits(newBalance);
            expect(storage.getTotalDeposits()).to.deep.equal(newBalance);
        });
    });
});
