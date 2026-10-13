import { stateSnapshot as stateSnapshotFactory } from "../factory";
import StateSnapshot from "@/models/StateSnapshot";
import { StateSnapshotStorage } from "@/storage/StateSnapshotStorage";
import { LogEntry } from "@/utils/logging/Logger";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";

describe("StateSnapshotStorage", () => {
    let storage: StateSnapshotStorage;
    let stateSnapshot: StateSnapshot;
    let genesisStateSnapshot: StateSnapshot;
    let logStore: LogStore;

    const warnings = (): LogEntry[] =>
        logStore.getAllLogs().filter((entry) => entry.level === "warn");

    // Same fork id and snapshotData as the registered genesis, later timestamp.
    const conflictingGenesisOf = (genesis: StateSnapshot): StateSnapshot =>
        StateSnapshot.from({
            ...genesis.toStruct(),
            timestamp: BigInt(genesis.timestamp + 1)
        });

    beforeEach(() => {
        logStore = new LogStore(1024 * 1024, true);
        storage = new StateSnapshotStorage(
            new NodeLogger({}, {}, "warn", logStore, undefined, new Set(), true)
        );

        stateSnapshot = stateSnapshotFactory();

        // Create genesis state snapshot (forkId === snapshotDataHash, height 0)
        const genesisSnapshot = stateSnapshotFactory({ blockHeight: 0 });
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
                const genesisStored = storage.getGenesisSnapshotByForkId(
                    genesisStateSnapshot.forkID
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
                const genesisStored = storage.getGenesisSnapshotByForkId(
                    genesisStateSnapshot.forkID
                );
                expect(genesisStored?.toStruct()).to.deep.equal(
                    genesisStateSnapshot.toStruct()
                );
            });
        });
    });

    describe("Genesis registration conflicts", () => {
        it("keeps the registered genesis and logs nothing when the same genesis is stored again", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const repeat = StateSnapshot.from({
                ...genesisStateSnapshot.toStruct()
            });

            const hash = storage.storeStateSnapshot(repeat);

            expect(hash).to.equal(genesisStateSnapshot.hash);
            expect(
                storage.getStateSnapshotByHash(hash)?.toStruct()
            ).to.deep.equal(genesisStateSnapshot.toStruct());
            expect(
                storage
                    .getGenesisSnapshotByForkId(genesisStateSnapshot.forkID)
                    ?.toStruct()
            ).to.deep.equal(genesisStateSnapshot.toStruct());
            expect(warnings()).to.have.length(0);
        });

        it("refuses a conflicting genesis for a known fork id and keeps the original registered", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const conflicting = conflictingGenesisOf(genesisStateSnapshot);
            expect(conflicting.isGenesis).to.be.true;
            expect(conflicting.forkID).to.equal(genesisStateSnapshot.forkID);

            storage.storeStateSnapshot(conflicting);

            const registered = storage.getGenesisSnapshotByForkId(
                genesisStateSnapshot.forkID
            );
            expect(registered?.timestamp).to.equal(
                genesisStateSnapshot.timestamp
            );
            expect(registered?.hash).to.equal(genesisStateSnapshot.hash);
        });

        it("still stores a refused conflicting genesis under its hash", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const conflicting = conflictingGenesisOf(genesisStateSnapshot);

            const hash = storage.storeStateSnapshot(conflicting);

            expect(hash).to.equal(conflicting.hash);
            expect(
                storage.getStateSnapshotByHash(conflicting.hash)?.toStruct()
            ).to.deep.equal(conflicting.toStruct());
            expect(
                storage.getGenesisSnapshotByForkId(conflicting.forkID)?.hash
            ).to.equal(genesisStateSnapshot.hash);
        });

        it("logs one warning naming the registered and the refused genesis on a conflict", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const conflicting = conflictingGenesisOf(genesisStateSnapshot);

            storage.storeStateSnapshot(conflicting);

            const logged = warnings();
            expect(logged).to.have.length(1);
            expect(logged[0].context.component).to.equal(
                "StateSnapshotStorage"
            );
            expect(logged[0].meta[0].registered.stateSnapshotHash).to.equal(
                genesisStateSnapshot.hash
            );
            expect(logged[0].meta[0].refused.stateSnapshotHash).to.equal(
                conflicting.hash
            );
        });

        it("registers a genesis for a different fork id next to an existing one", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const otherSnapshot = stateSnapshotFactory({ blockHeight: 0 });
            const otherGenesis = StateSnapshot.from({
                ...otherSnapshot.toStruct(),
                forkId: otherSnapshot.snapshotDataHash
            });

            storage.storeStateSnapshot(otherGenesis);

            expect(
                storage.getGenesisSnapshotByForkId(otherGenesis.forkID)?.hash
            ).to.equal(otherGenesis.hash);
            expect(
                storage.getGenesisSnapshotByForkId(genesisStateSnapshot.forkID)
                    ?.hash
            ).to.equal(genesisStateSnapshot.hash);
            expect(warnings()).to.have.length(0);
        });

        it("keeps the registered genesis when a non-genesis snapshot of the same fork is stored", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const forkSnapshot = stateSnapshotFactory({
                forkId: genesisStateSnapshot.forkID
            });
            expect(forkSnapshot.isGenesis).to.be.false;

            storage.storeStateSnapshot(forkSnapshot);

            expect(
                storage.getGenesisSnapshotByForkId(genesisStateSnapshot.forkID)
                    ?.hash
            ).to.equal(genesisStateSnapshot.hash);
            expect(warnings()).to.have.length(0);
        });

        it("stores a later-height snapshot with the genesis snapshotData by hash only, without touching the genesis index or warning", () => {
            storage.storeStateSnapshot(genesisStateSnapshot);
            const unchangedStateBlockSnapshot = StateSnapshot.from({
                ...genesisStateSnapshot.toStruct(),
                blockHeight: 7n
            });
            expect(unchangedStateBlockSnapshot.forkID).to.equal(
                genesisStateSnapshot.forkID
            );
            expect(unchangedStateBlockSnapshot.hash).to.not.equal(
                genesisStateSnapshot.hash
            );

            const hash = storage.storeStateSnapshot(
                unchangedStateBlockSnapshot
            );

            expect(hash).to.equal(unchangedStateBlockSnapshot.hash);
            expect(
                storage.getStateSnapshotByHash(hash)?.toStruct()
            ).to.deep.equal(unchangedStateBlockSnapshot.toStruct());
            expect(
                storage.getGenesisSnapshotByForkId(genesisStateSnapshot.forkID)
                    ?.hash
            ).to.equal(genesisStateSnapshot.hash);
            expect(warnings()).to.have.length(0);
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
            const result = storage.getGenesisSnapshotByForkId(
                genesisStateSnapshot.forkID
            );
            expect(result?.toStruct()).to.deep.equal(
                genesisStateSnapshot.toStruct()
            );
        });

        it("should return undefined for non-existent genesis forkId", () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getGenesisSnapshotByForkId(nonExistentForkId)).to.be
                .undefined;
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
            const genesisStored = storage.getGenesisSnapshotByForkId(
                stateSnapshot.forkID
            );
            expect(genesisStored).to.be.undefined;
        });
    });
});
