import {
    ScenarioRunner,
    Scenario,
    Assert,
    Transition,
    PeerTestHarness
} from "@test/harness";

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
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3),
                Scenario.advanceState(10),
                Assert.allPeersInSync(),
                Assert.blockHeight(9) // 10 blocks after genesis = height 9
            );
        });

        it("should handle full round rotation", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(4),
                Scenario.fullRound(), // All 4 peers write once
                Assert.allPeersInSync(),
                Assert.blockHeight(3) // 4 transitions = height 3
            );
        });

        it("should handle multiple rotation rounds", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3),
                Scenario.multipleRounds(3), // 3 rounds = 9 transitions
                Assert.allPeersInSync(),
                Assert.blockHeight(8)
            );
        });
    });

    describe("State Modifications", function () {
        it("should handle honest peer transitions after fork resolution", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannel(4, 2, {
                    timeConfig: {
                        p2pTime: 30,
                        agreementTime: 2,
                        chainFallbackTime: 2,
                        evidenceTime: 3
                    }
                }),
                Assert.allPeersInSync(),

                // Create and resolve fork (removes peer 2)
                Scenario.disputeWithReduction({ maliciousPeerIndex: 2 }),

                // Continue with honest peers only
                Transition.fromHonestPeersOnly((c) => c.add(1)),
                Transition.fromHonestPeersOnly((c) => c.add(2)),
                Transition.fromHonestPeersOnly((c) => c.add(3)),

                // Verify liveness maintained among honest peers
                Assert.onlyHonestPeersInSync(),
                Assert.maliciousPeerExcluded()
            );
        });
    });
});
