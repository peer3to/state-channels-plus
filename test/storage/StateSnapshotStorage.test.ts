import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { StateSnapshotStorage } from "@/storage/StateSnapshotStorage";
import StateSnapshot from "@/models/StateSnapshot";
import { stateSnapshot as stateSnapshotFactory } from "../factory";

describe("StateSnapshotStorage", () => {
    let storage: StateSnapshotStorage;
    let stateSnapshot: StateSnapshot;
    let genesisStateSnapshot: StateSnapshot;

    beforeEach(() => {
        storage = new StateSnapshotStorage();

        stateSnapshot = stateSnapshotFactory();

        // Create genesis state snapshot (forkId === snapshotDataHash)
        const genesisSnapshot = stateSnapshotFactory();
        const genesisSnapshotStruct = genesisSnapshot.toStruct();
        genesisSnapshotStruct.forkId = genesisSnapshot.snapshotDataHash;
        genesisStateSnapshot = StateSnapshot.from(genesisSnapshotStruct);
    });

    describe("CREATE - storeStateSnapshot()", () => {
        describe("Auto-computed hash", () => {
            it("should store snapshot with computed hash", () => {
                const hash = storage.storeStateSnapshot(stateSnapshot);
                expect(hash).to.equal(stateSnapshot.hash);

                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored?.toStruct()).to.deep.equal(
                    stateSnapshot.toStruct()
                );
            });

            it("should store genesis snapshot and auto-add to genesis mapping", () => {
                const hash = storage.storeStateSnapshot(genesisStateSnapshot);
                expect(hash).to.equal(genesisStateSnapshot.hash);

                // Should be stored in regular snapshot storage
                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );

                // Should be  added to genesis mapping
                const genesisStored = storage.getGenesisSnapshotDataByForkId(
                    genesisStateSnapshot.forkId
                );
                expect(genesisStored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );
            });
        });

        describe("Provided hash", () => {
            it("should store snapshot with provided hash", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeStateSnapshot(stateSnapshot, {
                    hash: customHash
                });
                expect(hash).to.equal(customHash);

                const stored = storage.getStateSnapshotByHash(customHash);
                expect(stored?.toStruct()).to.deep.equal(
                    stateSnapshot.toStruct()
                );
            });

            it("should store genesis snapshot with provided hash and auto-add to genesis mapping", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeStateSnapshot(genesisStateSnapshot, {
                    hash: customHash
                });
                expect(hash).to.equal(customHash);

                // Should be stored with custom hash
                const stored = storage.getStateSnapshotByHash(customHash);
                expect(stored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );

                // Should be  added to genesis mapping
                const genesisStored = storage.getGenesisSnapshotDataByForkId(
                    genesisStateSnapshot.forkId
                );
                expect(genesisStored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );
            });
        });
    });

    describe("READ operations", () => {
        beforeEach(() => {
            storage.storeStateSnapshot(stateSnapshot);
            storage.storeStateSnapshot(genesisStateSnapshot);
        });

        it("should get snapshot by hash", () => {
            const result = storage.getStateSnapshotByHash(stateSnapshot.hash);
            expect(result?.toStruct()).to.deep.equal(stateSnapshot.toStruct());
        });

        it("should return undefined for non-existent snapshot hash", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getStateSnapshotByHash(nonExistentHash)).to.be
                .undefined;
        });

        it("should get genesis snapshot by forkId", () => {
            const result = storage.getGenesisSnapshotDataByForkId(
                genesisStateSnapshot.forkId
            );
            expect(result?.toStruct()).to.deep.equal(
                genesisStateSnapshot.toStruct()
            );
        });

        it("should return undefined for non-existent genesis forkId", () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getGenesisSnapshotDataByForkId(nonExistentForkId)).to
                .be.undefined;
        });
    });

    describe("Genesis snapshot logic", () => {
        it("should identify genesis snapshot correctly", () => {
            expect(genesisStateSnapshot.isGenesis).to.be.true;
            expect(stateSnapshot.isGenesis).to.be.false;
        });

        it("should not non-genesis snapshots in genesis mapping", () => {
            // Store non-genesis snapshot
            storage.storeStateSnapshot(stateSnapshot);

            // Should not be in genesis mapping
            const genesisStored = storage.getGenesisSnapshotDataByForkId(
                stateSnapshot.forkId
            );
            expect(genesisStored).to.be.undefined;
        });
    });
});
