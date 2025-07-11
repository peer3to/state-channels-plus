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

describe("ExitChannelBlockStorage", () => {
    let storage: ExitChannelBlockStorage;
    let mockExitBlock: ExitChannelBlockStruct;
    let mockTotalWithdrawals: BalanceStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new ExitChannelBlockStorage();
        mockExitBlock = factory.exitChannelBlock();
        mockTotalWithdrawals = {
            amount: BigInt(500),
            data: "0x5678"
        };
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockExitBlock, Type.ExitChannelBlock)
        );
    });

    describe("CREATE - storeExitChannelBlock()", () => {
        it("should store block with auto-computed hash", () => {
            const hash = storage.storeExitChannelBlock(
                mockExitBlock,
                mockTotalWithdrawals
            );
            expect(hash).to.equal(mockBlockHash);

            const stored = storage.getExitChannelBlock(hash);
            expect(stored).to.equal(mockExitBlock);

            const storedWithdrawals = storage.getTotalWithdrawals(hash);
            expect(storedWithdrawals).to.deep.equal(mockTotalWithdrawals);
        });

        it("should store block with provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeExitChannelBlock(
                mockExitBlock,
                mockTotalWithdrawals,
                { hash: customHash }
            );
            expect(hash).to.equal(customHash);

            const stored = storage.getExitChannelBlock(customHash);
            expect(stored).to.equal(mockExitBlock);

            const storedWithdrawals = storage.getTotalWithdrawals(customHash);
            expect(storedWithdrawals).to.deep.equal(mockTotalWithdrawals);
        });

        it("should return same hash on duplicate store", () => {
            // First store succeeds
            const hash1 = storage.storeExitChannelBlock(
                mockExitBlock,
                mockTotalWithdrawals
            );
            expect(hash1).to.equal(mockBlockHash);

            // Second store with same hash should return same hash
            const hash2 = storage.storeExitChannelBlock(
                mockExitBlock,
                mockTotalWithdrawals
            );
            expect(hash2).to.equal(mockBlockHash);
            expect(hash1).to.equal(hash2);
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeExitChannelBlock(mockExitBlock, mockTotalWithdrawals);
        });

        it("should get block by hash", () => {
            const result = storage.getExitChannelBlock(mockBlockHash);
            expect(result).to.equal(mockExitBlock);
        });

        it("should get total withdrawals by hash", () => {
            const result = storage.getTotalWithdrawals(mockBlockHash);
            expect(result).to.deep.equal(mockTotalWithdrawals);
        });

        it("should get complete block entry by hash", () => {
            const result = storage.getExitChannelBlockEntry(mockBlockHash);
            expect(result).to.exist;
            expect(result?.block).to.equal(mockExitBlock);
            expect(result?.totalWithdrawals).to.deep.equal(
                mockTotalWithdrawals
            );
        });

        it("should return undefined for non-existent block", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getExitChannelBlock(nonExistentHash)).to.be
                .undefined;
            expect(storage.getTotalWithdrawals(nonExistentHash)).to.be
                .undefined;
            expect(storage.getExitChannelBlockEntry(nonExistentHash)).to.be
                .undefined;
        });
    });
});
