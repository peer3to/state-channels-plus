import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";

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
            await h.channel.start(3);
            await h.transition.advanceState({ count: 10 });
            await h.assert.sync.peersInSync();
            await h.assert.sync.blockHeight({ expectedHeight: 9 }); // 10 blocks after genesis = height 9
        });

        it("should handle full round rotation", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(4);
            await h.transition.advanceState({ rounds: 1 }); // All 4 peers write once
            await h.assert.sync.peersInSync();
            await h.assert.sync.blockHeight({ expectedHeight: 3 }); // 4 transitions = height 3
        });

        it("should handle multiple rotation rounds", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(3);
            await h.transition.advanceState({ rounds: 3 }); // 3 rounds = 9 transitions
            await h.assert.sync.peersInSync();
            await h.assert.sync.blockHeight({ expectedHeight: 8 });
        });
    });

    describe("State Modifications", function () {
        it("should handle honest peer transitions after fork resolution", async function () {
            this.timeout(90000);
            const h = TestSession.getHarness();

            await h.channel.start(4, 2, {
                timeConfig: {
                    p2pTime: 30,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            await h.assert.sync.peersInSync();

            const maliciousPeerIndex = 2;
            const honestPeerIndices = [0, 1, 3];
            const originalForkId = h.activeForkId!;

            h.context.maliciousPeerIndices = [maliciousPeerIndex];
            h.context.honestPeerIndices = honestPeerIndices;

            await h.dispute.createInvalidStateTransitionDispute(
                maliciousPeerIndex,
                {
                    forkId: originalForkId,
                    resetEventSpies: true
                }
            );

            const result = await h.dispute.resolveDispute({
                maliciousPeerIndex,
                forkId: originalForkId,
                honestPeerIndices,
                assertMaliciousRemoved: false
            });

            h.context.originalForkId = originalForkId;
            h.activeForkId = result.newForkId;

            await h.transition.submitNext((c) => c.add(1), {
                waitForTurn: true,
                waitForPeers: honestPeerIndices,
                waitForSync: true
            });
            await h.transition.submitNext((c) => c.add(2), {
                waitForTurn: true,
                waitForPeers: honestPeerIndices,
                waitForSync: true
            });
            await h.transition.submitNext((c) => c.add(3), {
                waitForTurn: true,
                waitForPeers: honestPeerIndices,
                waitForSync: true
            });

            await h.assert.sync.peersInSync({
                peerIndices: honestPeerIndices
            });

            const nextWriter = await h.query.getNextPeerToWrite();
            expect(nextWriter.index).to.not.equal(maliciousPeerIndex);
        });
    });
});
