import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { StateSnapshotStorage } from "@/storage/StateSnapshotStorage";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { stateSnapshot } from "../factory";

describe("StateSnapshotStorage", () => {
    let storage: StateSnapshotStorage;
    let mockSnapshot: StateSnapshotStruct;
    let mockSnapshotHash: Hash;
    let mockBlockHash: Hash;

    beforeEach(() => {
        storage = new StateSnapshotStorage();
        mockSnapshot = stateSnapshot();
        mockSnapshotHash = ethers.keccak256(
            Codec.encode(mockSnapshot, Type.StateSnapshot)
        );
        mockBlockHash = ethers.hexlify(ethers.randomBytes(32));
    });

    describe("CREATE - storeStateSnapshot()", () => {
        describe("[OVERLOAD 1] Auto-computed hash", () => {
            it("should store snapshot with computed hash", () => {
                const hash = storage.storeStateSnapshot(
                    mockSnapshot,
                    mockBlockHash
                );
                expect(hash).to.equal(mockSnapshotHash);

                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored).to.deep.equal(mockSnapshot);

                const posterior =
                    storage.getPosteriorStateSnapshot(mockBlockHash);
                expect(posterior).to.deep.equal(mockSnapshot);
            });
        });

        describe("[OVERLOAD 2] Provided hash", () => {
            it("should store snapshot with provided hash", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeStateSnapshot(
                    mockSnapshot,
                    mockBlockHash,
                    customHash
                );
                expect(hash).to.equal(customHash);

                const stored = storage.getStateSnapshotByHash(customHash);
                expect(stored).to.deep.equal(mockSnapshot);

                const posterior =
                    storage.getPosteriorStateSnapshot(mockBlockHash);
                expect(posterior).to.deep.equal(mockSnapshot);
            });
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeStateSnapshot(mockSnapshot, mockBlockHash);
        });

        it("should get snapshot by hash", () => {
            const result = storage.getStateSnapshotByHash(mockSnapshotHash);
            expect(result).to.deep.equal(mockSnapshot);
        });

        it("should get posterior state snapshot by block hash", () => {
            const result = storage.getPosteriorStateSnapshot(mockBlockHash);
            expect(result).to.deep.equal(mockSnapshot);
        });

        it("should return undefined for non-existent snapshot hash", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getStateSnapshotByHash(nonExistentHash)).to.be
                .undefined;
        });

        it("should return undefined for non-existent block hash", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getPosteriorStateSnapshot(nonExistentHash)).to.be
                .undefined;
        });
    });
});
