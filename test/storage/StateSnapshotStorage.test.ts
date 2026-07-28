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
            it("should store snapshot with computed hash", async () => {
                const hash = storage.storeStateSnapshot(stateSnapshot);
                expect(hash).to.equal(stateSnapshot.hash);

                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored?.toStruct()).to.deep.equal(
                    stateSnapshot.toStruct()
                );
            });

            it("should store genesis snapshot and auto-add to genesis mapping", async () => {
                const hash = storage.storeStateSnapshot(genesisStateSnapshot);
                expect(hash).to.equal(genesisStateSnapshot.hash);

                // Should be stored in regular snapshot storage
                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );

                // Should be  added to genesis mapping
                const genesisStored = storage.getGenesisSnapshotByForkId(
                    genesisStateSnapshot.forkID
                );
                expect(genesisStored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );
            });
        });

        describe("Provided hash", () => {
            it("should store snapshot with provided hash", async () => {
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

            it("should store genesis snapshot with provided hash and auto-add to genesis mapping", async () => {
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
                const genesisStored = storage.getGenesisSnapshotByForkId(
                    genesisStateSnapshot.forkID
                );
                expect(genesisStored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );
            });
        });
    });

    describe("READ operations", () => {
        beforeEach(async () => {
            storage.storeStateSnapshot(stateSnapshot);
            storage.storeStateSnapshot(genesisStateSnapshot);
        });

        it("should get snapshot by hash", async () => {
            const result = storage.getStateSnapshotByHash(stateSnapshot.hash);
            expect(result?.toStruct()).to.deep.equal(stateSnapshot.toStruct());
        });

        it("should return the number of stored snapshots", async () => {
            expect(storage.getSnapshotCount()).to.equal(2);
        });

        it("should return undefined for non-existent snapshot hash", async () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getStateSnapshotByHash(nonExistentHash)).to.be
                .undefined;
        });

        it("should get genesis snapshot by forkId", async () => {
            const result = storage.getGenesisSnapshotByForkId(
                genesisStateSnapshot.forkID
            );
            expect(result?.toStruct()).to.deep.equal(
                genesisStateSnapshot.toStruct()
            );
        });

        it("should return undefined for non-existent genesis forkId", async () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getGenesisSnapshotByForkId(nonExistentForkId)).to.be
                .undefined;
        });
    });

    describe("Genesis snapshot logic", () => {
        it("should identify genesis snapshot correctly", async () => {
            expect(genesisStateSnapshot.isGenesis).to.be.true;
            expect(stateSnapshot.isGenesis).to.be.false;
        });

        it("should not non-genesis snapshots in genesis mapping", async () => {
            // Store non-genesis snapshot
            storage.storeStateSnapshot(stateSnapshot);

            // Should not be in genesis mapping
            const genesisStored = storage.getGenesisSnapshotByForkId(
                stateSnapshot.forkID
            );
            expect(genesisStored).to.be.undefined;
        });
    });
});
