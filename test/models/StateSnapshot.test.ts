import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import StateSnapshot from "@/models/StateSnapshot";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, Type } from "@/utils";
import { stateSnapshot as stateSnapshotFactory } from "../factory";

describe("StateSnapshot Model", () => {
    let stateSnapshotStruct: StateSnapshotStruct;
    let stateSnapshot: StateSnapshot;
    let genesisStateSnapshot: StateSnapshot;

    beforeEach(() => {
        stateSnapshot = stateSnapshotFactory();
        stateSnapshotStruct = stateSnapshot.toStruct();

        // Create genesis state snapshot (forkId === snapshotDataHash)
        const tempGenesis = stateSnapshotFactory();
        const genesisStruct = tempGenesis.toStruct();

        genesisStruct.forkId = tempGenesis.snapshotDataHash;
        genesisStateSnapshot = StateSnapshot.from(genesisStruct);
    });

    describe("Static factory methods", () => {
        it("should create StateSnapshot from StateSnapshotStruct", () => {
            const snapshot = StateSnapshot.from(stateSnapshotStruct);
            expect(snapshot).to.be.instanceOf(StateSnapshot);
            expect(snapshot.toStruct()).to.deep.equal(stateSnapshotStruct);
        });

        it("should create StateSnapshot from encoded bytes", () => {
            const encoded = Codec.encode(
                stateSnapshotStruct,
                Type.StateSnapshot
            );
            const decoded = StateSnapshot.decode(encoded);
            expect(decoded).to.be.instanceOf(StateSnapshot);
            expect(decoded.toStruct()).to.deep.equal(stateSnapshotStruct);
        });
    });

    describe("Serialization", () => {
        it("should convert back to struct correctly", () => {
            const struct = stateSnapshot.toStruct();
            expect(struct).to.deep.equal(stateSnapshotStruct);
        });

        it("should round-trip encode/decode correctly", () => {
            const encoded = stateSnapshot.encode();
            const decoded = StateSnapshot.decode(encoded);
            expect(decoded.toStruct()).to.deep.equal(stateSnapshot.toStruct());
        });
    });

    describe("Hash computation", () => {
        it("should compute hash correctly", () => {
            const hash = stateSnapshot.hash;
            const expectedHash = ethers.keccak256(stateSnapshot.encode());
            expect(hash).to.equal(expectedHash);
        });

        it("should compute snapshotDataHash correctly", () => {
            const snapshotDataHash = stateSnapshot.snapshotDataHash;
            const expectedHash = ethers.keccak256(
                Codec.encode(stateSnapshot.snapshotData, Type.SnapshotData)
            );
            expect(snapshotDataHash).to.equal(expectedHash);
        });

        it("should have consistent hash for same data", () => {
            const snapshot1 = StateSnapshot.from(stateSnapshotStruct);
            const snapshot2 = StateSnapshot.from(stateSnapshotStruct);
            expect(snapshot1.hash).to.equal(snapshot2.hash);
        });
    });

    describe("Property getters", () => {
        it("should return correct forkId", () => {
            expect(stateSnapshot.forkId).to.equal(stateSnapshotStruct.forkId);
        });

        it("should return correct snapshotData", () => {
            expect(stateSnapshot.snapshotData).to.deep.equal(
                stateSnapshotStruct.snapshotData
            );
        });

        it("should return correct latestInboundMessageBlockHash", () => {
            const expected =
                stateSnapshotStruct.snapshotData.latestInboundMessageBlockHash;
            expect(stateSnapshot.latestInboundMessageBlockHash).to.equal(
                expected
            );
        });

        it("should return correct latestOutboundMessageBlockHash", () => {
            const expected =
                stateSnapshotStruct.snapshotData.latestOutboundMessageBlockHash;
            expect(stateSnapshot.latestOutboundMessageBlockHash).to.equal(
                expected
            );
        });
    });

    describe("Genesis snapshot logic", () => {
        it("should identify genesis snapshot correctly", () => {
            expect(genesisStateSnapshot.isGenesis).to.be.true;
            expect(genesisStateSnapshot.forkId).to.equal(
                genesisStateSnapshot.snapshotDataHash
            );
        });

        it("should identify non-genesis snapshot correctly", () => {
            expect(stateSnapshot.isGenesis).to.be.false;
            expect(stateSnapshot.forkId).to.not.equal(
                stateSnapshot.snapshotDataHash
            );
        });
    });

    describe("Data integrity", () => {
        it("should maintain data integrity through transformations", () => {
            const original = stateSnapshot.toStruct();
            const encoded = stateSnapshot.encode();
            const decoded = StateSnapshot.decode(encoded);
            const final = decoded.toStruct();

            expect(final).to.deep.equal(original);
        });
    });

    describe("Immutability", () => {
        it("should not allow modification of underlying data", () => {
            const originalStruct = stateSnapshot.toStruct();
            const retrievedStruct = stateSnapshot.toStruct();

            // Modify the retrieved struct
            retrievedStruct.forkId = ethers.hexlify(ethers.randomBytes(32));

            // Original should remain unchanged
            expect(stateSnapshot.toStruct()).to.deep.equal(originalStruct);
        });
    });
});
