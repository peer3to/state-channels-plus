import { block, transactionHeader } from "../factory";
import Storage from "@/storage";
import {
    heldBlockHeights,
    heldSnapshotHeights,
    heldStateHeights,
    storeForkHistory
} from "@test/fixtures/PruningStaging";
import { expect } from "chai";
import { describe, it } from "mocha";

describe("History pruning stores", () => {
    describe("BlockStorage deletes", () => {
        it("deleteBlocksInRange of heights 1..2 of blocks 0..3 → exactly those blocks are gone, their snapshot hashes are returned, the latest height stays 3", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 4);

            const deleted = storage.blocks.deleteBlocksInRange(
                history.forkId,
                1,
                2
            );

            expect(deleted).to.deep.equal([
                history.snapshots[1].hash,
                history.snapshots[2].hash
            ]);
            expect(heldBlockHeights(storage, history.forkId, 4)).to.deep.equal([
                0, 3
            ]);
            expect(
                storage.blocks.getLatestBlockHeight(history.forkId)
            ).to.equal(3);
        });

        it("deleteFork → every block of the fork is gone, also one stored above its head, its latest height is -1, and another fork's blocks stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3);
            const other = storeForkHistory(storage, 2);
            // a replayed tail block: stored above the head without moving it
            const aboveHead = block({
                header: transactionHeader({
                    forkId: history.forkId,
                    transactionCnt: 5
                })
            });
            storage.blocks.storeBlock(aboveHead, { justPersist: true });

            const deleted = storage.blocks.deleteFork(history.forkId);

            expect(deleted).to.have.lengthOf(4);
            expect(
                storage.blocks.getBlock(history.forkId, 5),
                "the block above the head"
            ).to.equal(undefined);
            expect(storage.blocks.getBlock(aboveHead.hash)).to.equal(undefined);
            expect(heldBlockHeights(storage, history.forkId, 6)).to.deep.equal(
                []
            );
            expect(
                storage.blocks.getLatestBlockHeight(history.forkId)
            ).to.equal(-1);
            expect(heldBlockHeights(storage, other.forkId, 2)).to.deep.equal([
                0, 1
            ]);
        });
    });

    describe("StateSnapshotStorage deletes", () => {
        it("deleteSnapshotsBelow height 2 → the fork's snapshots 0 and 1 are gone and their state hashes returned; 2, 3, the fork genesis and another fork's snapshots stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 4);
            const other = storeForkHistory(storage, 2);

            const stateHashes = storage.stateSnapshots.deleteSnapshotsBelow(
                history.forkId,
                2
            );

            expect(stateHashes).to.have.members([
                history.stateHashes[0],
                history.stateHashes[1]
            ]);
            expect(heldSnapshotHeights(storage, history)).to.deep.equal([2, 3]);
            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(
                    history.forkId
                )?.hash
            ).to.equal(history.genesis.hash);
            expect(
                storage.stateSnapshots.getStateSnapshotByHash(
                    history.genesis.hash
                )?.hash
            ).to.equal(history.genesis.hash);
            expect(heldSnapshotHeights(storage, other)).to.deep.equal([0, 1]);
        });

        it("deleteFork → every snapshot of the fork, its genesis too, is gone and their state hashes returned; another fork's snapshots stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 2);
            const other = storeForkHistory(storage, 2);

            const stateHashes = storage.stateSnapshots.deleteFork(
                history.forkId
            );

            expect(stateHashes).to.have.members([
                history.genesisStateHash,
                ...history.stateHashes
            ]);
            expect(heldSnapshotHeights(storage, history)).to.deep.equal([]);
            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(
                    history.forkId
                )
            ).to.equal(undefined);
            expect(
                storage.stateSnapshots.getStateSnapshotByHash(
                    history.genesis.hash
                )
            ).to.equal(undefined);
            expect(heldSnapshotHeights(storage, other)).to.deep.equal([0, 1]);
        });

        it("getReferencedStateHashes with excluded snapshots → the state hashes of every other held snapshot, the genesis included", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3);

            const referenced = storage.stateSnapshots.getReferencedStateHashes(
                new Set([history.snapshots[1].hash])
            );

            expect([...referenced]).to.have.members([
                history.genesisStateHash,
                history.stateHashes[0],
                history.stateHashes[2]
            ]);
        });
    });

    describe("StateMachineStateStorage deletes", () => {
        it("deleteStateMachineState → true and the state is gone; a second delete is false; other states stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 2);
            const [deletedHash, keptHash] = history.stateHashes;

            const first =
                storage.stateMachineStates.deleteStateMachineState(deletedHash);
            const second =
                storage.stateMachineStates.deleteStateMachineState(deletedHash);

            expect(first).to.equal(true);
            expect(second).to.equal(false);
            expect(
                storage.stateMachineStates.getStateMachineState(deletedHash)
            ).to.equal(undefined);
            expect(
                storage.stateMachineStates.getStateMachineState(keptHash)
            ).to.not.equal(undefined);
        });
    });

    describe("ParticipantSetChangeStorage deletes", () => {
        it("deleteChangePointsBelow height 2 → 2 deleted, the points at 2 and 3 and another fork's points stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 4);
            const other = storeForkHistory(storage, 2);

            const deletedCount =
                storage.participantSetChanges.deleteChangePointsBelow(
                    history.forkId,
                    2
                );

            expect(deletedCount).to.equal(2);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    history.forkId
                )
            ).to.deep.equal([2, 3]);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    other.forkId
                )
            ).to.deep.equal([0, 1]);
        });

        it("deleteFork → every change point of the fork is gone and counted; another fork's points stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3);
            const other = storeForkHistory(storage, 2);

            const deletedCount = storage.participantSetChanges.deleteFork(
                history.forkId
            );

            expect(deletedCount).to.equal(3);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    history.forkId
                )
            ).to.deep.equal([]);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    other.forkId
                )
            ).to.deep.equal([0, 1]);
        });
    });

    describe("Storage.pruneSkippedHistory", () => {
        it("anchor 0 and final point 3 over blocks 0..4 → blocks and states 1 and 2 are gone; their snapshots, the anchor and final-point blocks, the tail and the change points stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 5);

            const pruned = storage.pruneSkippedHistory(history.forkId, 0, 3);

            expect(pruned).to.deep.equal({
                blockCount: 2,
                snapshotCount: 0,
                stateCount: 2,
                changePointCount: 0
            });
            expect(heldBlockHeights(storage, history.forkId, 5)).to.deep.equal([
                0, 3, 4
            ]);
            expect(heldStateHeights(storage, history)).to.deep.equal([0, 3, 4]);
            expect(heldSnapshotHeights(storage, history)).to.deep.equal([
                0, 1, 2, 3, 4
            ]);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    history.forkId
                )
            ).to.deep.equal([0, 1, 2, 3, 4]);
        });

        it("an anchor at the fork genesis (-1) → block 0 is skipped history too", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3);

            storage.pruneSkippedHistory(history.forkId, -1, 2);

            expect(heldBlockHeights(storage, history.forkId, 3)).to.deep.equal([
                2
            ]);
            expect(heldStateHeights(storage, history)).to.deep.equal([2]);
            expect(
                storage.stateMachineStates.getStateMachineState(
                    history.genesisStateHash
                ),
                "the genesis state"
            ).to.not.equal(undefined);
        });

        it("a skipped block whose state is also the final point's → that shared state stays, the other skipped state is gone", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 4, {
                sharedStateHeights: [2, 3]
            });

            const pruned = storage.pruneSkippedHistory(history.forkId, 0, 3);

            expect(pruned.blockCount).to.equal(2);
            expect(pruned.stateCount).to.equal(1);
            expect(heldStateHeights(storage, history)).to.deep.equal([0, 2, 3]);
        });

        it("a final point right above the anchor → nothing is skipped, nothing is deleted", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3);

            const pruned = storage.pruneSkippedHistory(history.forkId, 1, 2);

            expect(pruned).to.deep.equal({
                blockCount: 0,
                snapshotCount: 0,
                stateCount: 0,
                changePointCount: 0
            });
            expect(heldBlockHeights(storage, history.forkId, 3)).to.deep.equal([
                0, 1, 2
            ]);
            expect(heldStateHeights(storage, history)).to.deep.equal([0, 1, 2]);
        });
    });

    describe("Storage.pruneBelowAnchor", () => {
        it("anchor 2 over blocks 0..4 → blocks, snapshots, states and change points 0 and 1 are gone; the anchor block, its snapshot and state, the blocks above and the fork genesis with its state stay", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 5);

            const pruned = storage.pruneBelowAnchor(history.forkId, 2);

            expect(pruned).to.deep.equal({
                blockCount: 2,
                snapshotCount: 2,
                stateCount: 2,
                changePointCount: 2
            });
            expect(heldBlockHeights(storage, history.forkId, 5)).to.deep.equal([
                2, 3, 4
            ]);
            expect(heldSnapshotHeights(storage, history)).to.deep.equal([
                2, 3, 4
            ]);
            expect(heldStateHeights(storage, history)).to.deep.equal([2, 3, 4]);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    history.forkId
                )
            ).to.deep.equal([2, 3, 4]);
            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(
                    history.forkId
                )?.hash
            ).to.equal(history.genesis.hash);
            expect(
                storage.getGenesisStateMachineState(history.forkId)
            ).to.not.equal(undefined);
        });

        it("a pruned block whose state is also the fork genesis state → the genesis state stays", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 3, {
                genesisStateHeights: [0]
            });

            const pruned = storage.pruneBelowAnchor(history.forkId, 2);

            expect(pruned.snapshotCount).to.equal(2);
            expect(pruned.stateCount).to.equal(1);
            expect(
                storage.getGenesisStateMachineState(history.forkId)
            ).to.not.equal(undefined);
            expect(heldStateHeights(storage, history)).to.deep.equal([0, 2]);
        });

        it("an anchor at height 0 → nothing is below it, nothing is deleted", () => {
            const storage = new Storage();
            const history = storeForkHistory(storage, 2);

            const pruned = storage.pruneBelowAnchor(history.forkId, 0);

            expect(pruned).to.deep.equal({
                blockCount: 0,
                snapshotCount: 0,
                stateCount: 0,
                changePointCount: 0
            });
            expect(heldSnapshotHeights(storage, history)).to.deep.equal([0, 1]);
        });
    });

    describe("Storage.pruneFork", () => {
        it("a left fork → its blocks, snapshots (the genesis too), states and change points are gone; a state the next fork's genesis also holds stays, and the next fork is untouched", () => {
            const storage = new Storage();
            const left = storeForkHistory(storage, 3);
            const reducedState =
                storage.stateMachineStates.getStateMachineState(
                    left.stateHashes[2]
                )!;
            const next = storeForkHistory(storage, 2, {
                genesisState: reducedState
            });

            const pruned = storage.pruneFork(left.forkId);

            expect(pruned).to.deep.equal({
                blockCount: 3,
                snapshotCount: 4,
                stateCount: 3,
                changePointCount: 3
            });
            expect(heldBlockHeights(storage, left.forkId, 3)).to.deep.equal([]);
            expect(heldSnapshotHeights(storage, left)).to.deep.equal([]);
            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(left.forkId)
            ).to.equal(undefined);
            expect(heldStateHeights(storage, left)).to.deep.equal([2]);
            expect(
                storage.participantSetChanges.getChangePointsInRange(
                    left.forkId
                )
            ).to.deep.equal([]);
            expect(heldBlockHeights(storage, next.forkId, 2)).to.deep.equal([
                0, 1
            ]);
            expect(heldStateHeights(storage, next)).to.deep.equal([0, 1]);
            expect(storage.getGenesisStateMachineState(next.forkId)).to.equal(
                reducedState
            );
        });
    });
});
