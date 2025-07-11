import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
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
    let balance: BalanceStruct;

    beforeEach(() => {
        storage = new ExitChannelBlockStorage();
        mockExitBlock = factory.exitChannelBlock();
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockExitBlock, Type.ExitChannelBlock)
        );
        balance = {
            amount: 100,
            data: "0x"
        };
    });

    describe("CREATE - storeExitChannelBlock()", () => {
        it("should store block and return hash with auto-computed hash", () => {
            const hash = storage.storeExitChannelBlock(mockExitBlock, balance);
            expect(hash).to.equal(mockBlockHash);

            const stored = storage.getExitChannelBlock(hash);
            expect(stored).to.equal(mockExitBlock);
        });

        it("should store block with provided hash", () => {
            const fakeHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeExitChannelBlock(
                mockExitBlock,
                balance,
                fakeHash
            );
            expect(hash).to.equal(fakeHash);

            const stored = storage.getExitChannelBlock(fakeHash);
            expect(stored).to.equal(mockExitBlock);
        });

        it("should return existing hash on duplicate hash", () => {
            // First store succeeds
            storage.storeExitChannelBlock(mockExitBlock, balance);

            // Second store with same hash should throw
            expect(
                storage.storeExitChannelBlock(
                    mockExitBlock,
                    balance,
                    mockBlockHash
                )
            ).to.equal(mockBlockHash);
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeExitChannelBlock(
                mockExitBlock,
                balance,
                mockBlockHash
            );
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

        it("should get total withdrawals by hash", () => {
            const result = storage.getTotalWithdrawals(mockBlockHash);
            expect(result).to.equal(balance);
        });

        it("should return undefined for non-existent total withdrawals", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getTotalWithdrawals(nonExistentHash)).to.be
                .undefined;
        });

        it("should get exit channel block entry by hash", () => {
            const result = storage.getExitChannelBlockEntry(mockBlockHash);
            expect(result).to.deep.equal({
                block: mockExitBlock,
                totalWithdrawals: balance
            });
        });
    });
});
