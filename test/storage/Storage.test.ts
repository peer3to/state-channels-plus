import { expect } from "chai";
import { describe, it, beforeEach, before } from "mocha";
import Storage from "@/storage";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { BlockCoordinates, Block, StateSnapshot } from "@/models";
import * as factory from "../factory";
import { ForkId } from "@/types/types";
import { BlockConfirmationStruct } from "@/index";

describe("Storage", () => {
    describe("getStateSnapshot", () => {
        let genesisSnapshot: StateSnapshot;
        let blockSnapshot: StateSnapshot;
        let block: Block;
        let blockConfirmation: BlockConfirmationStruct;
        let forkId: ForkId;
        let storage: Storage;

        before(() => {
            const stateSnapshot = factory.stateSnapshot();
            forkId = stateSnapshot.snapshotDataHash;

            // Create genesis state snapshot - needs to be marked as genesis
            // A snapshot is genesis if forkId === snapshotDataHash
            const stateSnapshotStruct = stateSnapshot.toStruct();
            stateSnapshotStruct.forkId = stateSnapshot.snapshotDataHash;
            genesisSnapshot = StateSnapshot.from(stateSnapshotStruct);

            // Create a block state snapshot
            blockSnapshot = factory.stateSnapshot({
                forkId: forkId
            });

            // Create a mock block with the block snapshot hash
            block = factory.block({
                stateSnapshotHash: blockSnapshot.hash,
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1
                    })
                })
            });

            // Create a mock block confirmation that contains the signed block
            blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode()
                })
            });
        });

        beforeEach(() => {
            storage = new Storage();

            // Set up the storage with our fixtures
            // Store genesis snapshot - it will be automatically stored as genesis if isGenesis is true
            storage.stateSnapshots.storeStateSnapshot(genesisSnapshot);

            // Store block snapshot by hash
            storage.stateSnapshots.storeStateSnapshot(blockSnapshot);

            // Store block confirmation (at forkId, height 1)
            storage.blocks.storeBlockConfirmation(blockConfirmation);
        });

        it("should return genesis state snapshot when height < 0", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                height: -1
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.exist;
            expect(result.toStruct()).to.deep.equal(genesisSnapshot.toStruct());
        });

        it("should return genesis state snapshot when height is any negative number", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                // Random height between -200 and -100
                height: Math.floor(Math.random() * 100) - 200
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.exist;
            expect(result.toStruct()).to.deep.equal(genesisSnapshot.toStruct());
        });

        it("should return state snapshot from block when height >= 0", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                height: 1
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.exist;
            expect(result.toStruct()).to.deep.equal(blockSnapshot.toStruct());
        });

        it("genesis snapshot doesn't exist", () => {
            const nonExistentForkId =
                "0x9999999999999999999999999999999999999999999999999999999999999999";

            expect(
                storage.getStateSnapshot({
                    forkId: nonExistentForkId,
                    height: -1
                })
            ).to.be.undefined;
        });

        it("block confirmation doesn't exist", () => {
            expect(
                storage.getStateSnapshot({
                    forkId: forkId,
                    height: 999 // Non-existent height
                })
            ).to.be.undefined;
        });

        it("correct block height, wrong forkId", () => {
            const wrongForkId =
                "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
            expect(
                storage.getStateSnapshot({
                    forkId: wrongForkId,
                    height: 1
                })
            ).to.be.undefined;
        });
    });
});
