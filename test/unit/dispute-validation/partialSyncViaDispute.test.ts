import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

// Partial syncing via dispute validation: a validator missing blocks or
// snapshot data catches up THROUGH a valid dispute's state proof (the
// replay/justPersist path) instead of rejecting it.

describe("dispute-validation / partialSyncViaDispute", function () {
    it(
        "should have missing state Storage when peer receives dispute with blocks it doesn't have",
        covers(
            {
                stateProof: "valid"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 1);
                await h.assert.sync.peersInSyncWait();
                h.event.resetEventSpies();
                h.byzantine.stubBroadcast(1);
                await h.transition.advanceState({ waitForSync: false });

                await h.assert.sync.peerBlockHeightGreaterThan(1, 2);
                await h.assert.sync.blockHeight({
                    expectedHeight: 0,
                    peerIndices: [0, 2]
                });
                await h.assert.sync.blockHeight({
                    expectedHeight: 1,
                    peerIndices: [1]
                });
                const forkId = h.activeForkId;
                await h.byzantine.submitInvalidStateTransitionBlock(0);

                await h.event.waitForPeers("onDisputeCommitted", [1, 2], 2, {
                    mode: "atLeast"
                });

                // Height should remain, the same, but block and state should be in storage
                await h.assert.sync.blockHeight({
                    expectedHeight: 0,
                    peerIndices: [0, 2]
                });
                await h.assert.storage.honestPeersStoredBlockAndStateWait({
                    height: 1
                });
                if (forkId != h.activeForkId) {
                    throw new Error("ForkId not the same after sync");
                }
            }
        )
    );

    it(
        "should handle valid dispute when validating peer is missing snapshot data",
        covers(
            {
                stateProof: "valid"
            },
            async function () {
                // TODO
                // This is NOT a good test, since peer 2 will try and timeout peer 0 and while doing so will fetch on-chain block (and run it through the pipeline) while checking race condition (calldata posted)
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 0);
                h.byzantine.stubCalldataHandler(2);
                h.contextApi.storeSnapshotCount(2, "before_isolation");
                await h.byzantine.disconnect(2);
                h.event.resetEventSpies();

                await h.transition.advanceState({
                    waitForPeers: [0, 1],
                    count: 2
                });
                await h.event.waitForDisputeFromAnyPeer([0, 1]);
                await h.assert.snapshot.snapshotCountIncreasedSince(
                    2,
                    "before_isolation"
                );
                await h.assert.storage.honestPeersStoredBlockAndStateWait({
                    height: 1
                });
                h.byzantine.restoreCalldataHandler(2);
            }
        )
    );
});
