import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import { StateSnapshotStorage } from "@/storage/StateSnapshotStorage";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { stateSnapshot as stateSnapshotFactory } from "../factory";

describe("StateSnapshotStorage", () => {
    let storage: StateSnapshotStorage;
    let stateSnapshot: StateSnapshotStruct;
    let snapshotHash: Hash;

    beforeEach(() => {
        storage = new StateSnapshotStorage();
        stateSnapshot = stateSnapshotFactory();
        snapshotHash = ethers.keccak256(
            Codec.encode(stateSnapshot, Type.StateSnapshot)
        );
    });

    describe("CREATE - storeStateSnapshot()", () => {
        describe("[OVERLOAD 1] Auto-computed hash", () => {
            it("should store snapshot with computed hash", () => {
                const hash = storage.storeStateSnapshot(stateSnapshot);
                expect(hash).to.equal(snapshotHash);

                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored).to.deep.equal(stateSnapshot);
            });
        });

        describe("[OVERLOAD 2] Provided hash", () => {
            it("should store snapshot with provided hash", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeStateSnapshot(
                    stateSnapshot,
                    customHash
                );
                expect(hash).to.equal(customHash);

                const stored = storage.getStateSnapshotByHash(customHash);
                expect(stored).to.deep.equal(stateSnapshot);
            });
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeStateSnapshot(stateSnapshot);
        });

        it("should get snapshot by hash", () => {
            const result = storage.getStateSnapshotByHash(snapshotHash);
            expect(result).to.deep.equal(stateSnapshot);
        });

        it("should return undefined for non-existent snapshot hash", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getStateSnapshotByHash(nonExistentHash)).to.be
                .undefined;
        });
    });
});
