import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { StateMachineStateStorage } from "@/storage/StateMachineStateStorage";
import Storage from "@/storage";
import { Hash, Bytes, ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import * as factory from "../factory";

describe("StateMachineStateStorage", () => {
    let storage: StateMachineStateStorage;
    let mockEncodedState: Bytes;
    let mockStateHash: Hash;

    beforeEach(() => {
        storage = new StateMachineStateStorage();
        mockEncodedState = ethers.hexlify(ethers.randomBytes(64));
        mockStateHash = ethers.keccak256(mockEncodedState);
    });

    describe("Basic operations", () => {
        it("should store state with auto-computed hash", () => {
            const hash = storage.storeStateMachineState(mockEncodedState);
            expect(hash).to.equal(mockStateHash);

            const stored = storage.getStateMachineState(hash);
            expect(stored).to.equal(mockEncodedState);
        });

        it("should store state with provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeStateMachineState(mockEncodedState, {
                hash: customHash
            });
            expect(hash).to.equal(customHash);

            const stored = storage.getStateMachineState(customHash);
            expect(stored).to.equal(mockEncodedState);
        });

        it("should get state by hash", () => {
            storage.storeStateMachineState(mockEncodedState);
            const result = storage.getStateMachineState(mockStateHash);
            expect(result).to.equal(mockEncodedState);
        });

        it("should return undefined for non-existent hash", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getStateMachineState(nonExistentHash)).to.be
                .undefined;
        });
    });

    describe("getGenesisStateMachineState", () => {
        let mainStorage: Storage;
        let genesisSnapshot: StateSnapshot;
        let forkId: ForkId;
        let stateMachineStateHash: Hash;
        let encodedStateMachineState: Bytes;

        beforeEach(() => {
            mainStorage = new Storage();

            // Create encoded state machine state
            encodedStateMachineState = ethers.hexlify(ethers.randomBytes(128));
            stateMachineStateHash = ethers.keccak256(encodedStateMachineState);

            // Create genesis state snapshot with the stateMachineStateHash
            const baseSnapshot = factory.stateSnapshot();
            const genesisSnapshotStruct = baseSnapshot.toStruct();
            // link it to the state machine state
            genesisSnapshotStruct.snapshotData.stateMachineStateHash =
                stateMachineStateHash;
            // make it genesis
            genesisSnapshotStruct.forkId = baseSnapshot.snapshotDataHash;

            genesisSnapshot = StateSnapshot.from(genesisSnapshotStruct);

            forkId = genesisSnapshot.forkId;

            // Store the genesis snapshot
            mainStorage.stateSnapshots.storeStateSnapshot(genesisSnapshot);

            // Store the encoded state machine state
            mainStorage.stateMachineStates.storeStateMachineState(
                encodedStateMachineState
            );
        });

        it("should return correct bytes for correct fork ID", () => {
            const result = mainStorage.getGenesisStateMachineState(forkId);
            expect(result).to.equal(encodedStateMachineState);
        });

        it("should return undefined for incorrect fork ID", () => {
            const incorrectForkId = ethers.hexlify(ethers.randomBytes(32));
            const result =
                mainStorage.getGenesisStateMachineState(incorrectForkId);

            expect(result).to.be.undefined;
        });

        it("should return undefined when genesis snapshot exists but stateMachineStateHash is not in storage", () => {
            // Create a new genesis snapshot with a different stateMachineStateHash
            const baseSnapshot = factory.stateSnapshot();
            const orphanedSnapshotStruct = baseSnapshot.toStruct();
            // link it to the state machine state that is not in storage
            orphanedSnapshotStruct.snapshotData.stateMachineStateHash =
                ethers.hexlify(ethers.randomBytes(32));
            const orphanedSnapshot = StateSnapshot.from(orphanedSnapshotStruct);

            // make it genesis
            orphanedSnapshotStruct.forkId = baseSnapshot.snapshotDataHash;

            // Store the snapshot but NOT the corresponding state machine state
            mainStorage.stateSnapshots.storeStateSnapshot(orphanedSnapshot);

            const result = mainStorage.getGenesisStateMachineState(
                orphanedSnapshot.forkId
            );

            expect(result).to.be.undefined;
        });
    });
});
