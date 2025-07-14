import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
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
    let mockTotalDeposits: BalanceStruct;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new JoinChannelBlockStorage();
        mockJoinBlock = factory.joinChannelBlock();
        mockTotalDeposits = {
            amount: BigInt(1000),
            data: "0x1234"
        };
        mockBlockHash = ethers.keccak256(
            Codec.encode(mockJoinBlock, Type.JoinChannelBlock)
        );
    });

    describe("CREATE - storeJoinChannelBlock()", () => {
        it("should store block with auto-computed hash", () => {
            const hash = storage.storeJoinChannelBlock(
                mockJoinBlock,
                mockTotalDeposits
            );
            expect(hash).to.equal(mockBlockHash);

            const stored = storage.getJoinChannelBlock(hash);
            expect(stored).to.equal(mockJoinBlock);

            const storedDeposits = storage.getTotalDeposits(hash);
            expect(storedDeposits).to.deep.equal(mockTotalDeposits);
        });

        it("should store block with provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeJoinChannelBlock(
                mockJoinBlock,
                mockTotalDeposits,
                { hash: customHash }
            );
            expect(hash).to.equal(customHash);

            const stored = storage.getJoinChannelBlock(customHash);
            expect(stored).to.equal(mockJoinBlock);

            const storedDeposits = storage.getTotalDeposits(customHash);
            expect(storedDeposits).to.deep.equal(mockTotalDeposits);
        });

        it("should return same hash on duplicate store", () => {
            // First store succeeds
            const hash1 = storage.storeJoinChannelBlock(
                mockJoinBlock,
                mockTotalDeposits
            );
            expect(hash1).to.equal(mockBlockHash);

            // Second store with same hash should return same hash
            const hash2 = storage.storeJoinChannelBlock(
                mockJoinBlock,
                mockTotalDeposits
            );
            expect(hash2).to.equal(mockBlockHash);
            expect(hash1).to.equal(hash2);
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeJoinChannelBlock(mockJoinBlock, mockTotalDeposits);
        });

        it("should get block by hash", () => {
            const result = storage.getJoinChannelBlock(mockBlockHash);
            expect(result).to.equal(mockJoinBlock);
        });

        it("should get total deposits by hash", () => {
            const result = storage.getTotalDeposits(mockBlockHash);
            expect(result).to.deep.equal(mockTotalDeposits);
        });

        it("should get complete block entry by hash", () => {
            const result = storage.getJoinChannelBlockEntry(mockBlockHash);
            expect(result).to.exist;
            expect(result?.block).to.equal(mockJoinBlock);
            expect(result?.totalDeposits).to.deep.equal(mockTotalDeposits);
        });

        it("should return undefined for non-existent block", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getJoinChannelBlock(nonExistentHash)).to.be
                .undefined;
            expect(storage.getTotalDeposits(nonExistentHash)).to.be.undefined;
            expect(storage.getJoinChannelBlockEntry(nonExistentHash)).to.be
                .undefined;
        });
    });
});
