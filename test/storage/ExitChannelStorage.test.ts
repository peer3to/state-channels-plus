import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { ExitChannelBlockStorage } from "@/storage/ExitChannelBlockStorage";
import {
    ExitChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type } from "@/utils";

describe("ExitChannelStorage", () => {
    let storage: ExitChannelBlockStorage;
    let mockExitBlock: ExitChannelBlockStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new ExitChannelBlockStorage();
        mockExitBlock = factory.exitChannelBlock();
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockExitBlock, Type.ExitChannelBlock)
        );
    });

    describe("CREATE - storeExitChannelBlock()", () => {
        it("should store block and return hash with auto-computed hash", () => {
            const hash = storage.storeExitChannelBlock(mockExitBlock);
            expect(hash).to.equal(mockBlockHash);

            const stored = storage.getExitChannelBlock(hash);
            expect(stored).to.equal(mockExitBlock);
        });

        it("should store block with provided hash", () => {
            const fakeHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeExitChannelBlock(mockExitBlock, fakeHash);
            expect(hash).to.equal(fakeHash);

            const stored = storage.getExitChannelBlock(fakeHash);
            expect(stored).to.equal(mockExitBlock);
        });

        it("should throw on duplicate hash", () => {
            // First store succeeds
            storage.storeExitChannelBlock(mockExitBlock, mockBlockHash);

            // Second store with same hash should throw
            expect(() => {
                storage.storeExitChannelBlock(mockExitBlock, mockBlockHash);
            }).to.throw(/already exists/);
        });

        it("should update latest block hash", () => {
            const hash = storage.storeExitChannelBlock(mockExitBlock);
            expect(storage.getLatestExitChannelBlockHash()).to.equal(hash);

            // Store another block
            const newBlock = factory.exitChannelBlock();
            const newHash = storage.storeExitChannelBlock(newBlock);
            expect(storage.getLatestExitChannelBlockHash()).to.equal(newHash);
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeExitChannelBlock(mockExitBlock, mockBlockHash);
        });

        it("should get block by hash", () => {
            const result = storage.getExitChannelBlock(mockBlockHash);
            expect(result).to.equal(mockExitBlock);
        });

        it("should return undefined for non-existent block", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getExitChannelBlock(nonExistentHash)).to.be
                .undefined;
        });

        it("should get latest block", () => {
            expect(storage.getLatestExitChannelBlock()).to.equal(mockExitBlock);
        });

        it("should get latest block hash", () => {
            expect(storage.getLatestExitChannelBlockHash()).to.equal(
                mockBlockHash
            );
        });
    });

    describe("Total Withdrawals", () => {
        it("should initialize with zero balance", () => {
            expect(storage.getTotalWithdrawals()).to.deep.equal({
                amount: BigInt(0),
                data: "0x"
            });
        });

        it("should update total withdrawals", () => {
            const newBalance: BalanceStruct = {
                amount: BigInt(1000),
                data: "0x1234"
            };
            storage.setTotalWithdrawals(newBalance);
            expect(storage.getTotalWithdrawals()).to.deep.equal(newBalance);
        });
    });
});
