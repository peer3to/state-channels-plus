import { expect } from "chai";
import { describe, it, beforeEach, before } from "mocha";
import Storage from "@/storage";
import { BlockCoordinates, Block, StateSnapshot } from "@/models";
import * as factory from "../factory";
import { ForkId } from "@/types/types";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

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

            // Create genesis state snapshot
            // A snapshot is genesis if forkId === snapshotDataHash
            const stateSnapshotStruct = stateSnapshot.toStruct();
            stateSnapshotStruct.forkId = stateSnapshot.snapshotDataHash;
            genesisSnapshot = StateSnapshot.from(stateSnapshotStruct);

            // block state snapshot
            blockSnapshot = factory.stateSnapshot({
                forkId: forkId
            });

            // block with the block snapshot hash
            block = factory.block({
                stateSnapshotHash: blockSnapshot.hash,
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1
                    })
                })
            });

            // block confirmation that contains the signed block
            blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode()
                })
            });
        });

        beforeEach(() => {
            storage = new Storage();

            // Store genesis snapshot
            storage.stateSnapshots.storeStateSnapshot(genesisSnapshot);

            // Store block snapshot
            storage.stateSnapshots.storeStateSnapshot(blockSnapshot);

            // Store block confirmation (at forkId, height 1)
            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmation)
            );
        });

        it("should return genesis state snapshot when height < 0", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                height: -1
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.not.be.undefined;
            expect(result?.toStruct()).to.deep.equal(
                genesisSnapshot.toStruct()
            );
        });

        it("should return genesis state snapshot when height is any negative number", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                // Random height between -200 and -100
                height: Math.floor(Math.random() * 100) - 200
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.not.be.undefined;
            expect(result?.toStruct()).to.deep.equal(
                genesisSnapshot.toStruct()
            );
        });

        it("should return state snapshot from block when height >= 0", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                height: 1
            };

            const result = storage.getStateSnapshot(coordinates);

            expect(result).to.not.be.undefined;
            expect(result?.toStruct()).to.deep.equal(blockSnapshot.toStruct());
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

        it("modifying retrieved snapshot doesn't affect stored snapshot", () => {
            const coordinates: BlockCoordinates = {
                forkId: forkId,
                height: 1
            };

            const snapshot1 = storage.getStateSnapshot(coordinates);
            const orignalHash = snapshot1!.hash;
            expect(snapshot1).to.deep.equal(blockSnapshot);

            // Modify the retrieved snapshot's snapshotData
            snapshot1!.snapshotData.latestInboundMessageBlockHash = "0x11";
            snapshot1!.snapshotData.latestOutboundMessageBlockHash = "0x22";

            // Get snapshot second time
            const snapshot2 = storage.getStateSnapshot(coordinates);
            expect(snapshot2).to.not.be.undefined;

            // Assert that the stored snapshot was not affected by the modification
            expect(snapshot2!.hash).to.equal(orignalHash);
            expect(snapshot2!.toStruct()).to.deep.equal(
                blockSnapshot.toStruct()
            );
            expect(snapshot2!.toStruct()).to.not.equal(snapshot1!.toStruct());
        });
    });
});
