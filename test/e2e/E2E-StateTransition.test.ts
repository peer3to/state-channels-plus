import { TestSession, PeerTestHarness } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for State Transitions
 *
 * Maps to: src/rpc/services/stateTransition/
 *          src/stateManager/StateManager.ts
 *
 * Tests the core state transition mechanism, block creation, and state advancement.
 */
describe("E2E: State Transitions", function () {
    describe("Basic State Advancement", function () {
        it("should handle consecutive blocks between participants", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3);
            await h.transition.advanceState({ count: 10 });
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 9 }); // 10 blocks after genesis = height 9
        });

        it("should handle full round rotation", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4);
            await h.transition.advanceState({ rounds: 1 }); // All 4 peers write once
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 3 }); // 4 transitions = height 3
        });

        it("should handle multiple rotation rounds", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3);
            await h.transition.advanceState({ rounds: 3 }); // 3 rounds = 9 transitions
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 8 });
        });
    });

    describe("State Modifications", function () {
        it("should handle honest peer transitions after fork resolution", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(4, 2);
            await h.assert.sync.peersInSyncWait();

            const maliciousPeerIndex = 2;

            await h.dispute.createInvalidStateTransitionDispute(
                maliciousPeerIndex,
                {
                    resetEventSpies: true
                }
            );
            await h.assert.dispute.initiatedAndCommitedWait();
            const result = await h.dispute.resolveDisputeWait({
                maliciousPeerIndex,
                assertMaliciousRemoved: false
            });

            await h.transition.submitNext((c) => c.add(1), {
                waitForTurn: true,
                waitForSync: true
            });
            await h.transition.submitNext((c) => c.add(2), {
                waitForTurn: true,
                waitForSync: true
            });
            await h.transition.submitNext((c) => c.add(3), {
                waitForTurn: true,
                waitForSync: true
            });

            await h.assert.sync.onlyHonestPeersInSync();
        });
    });
});
