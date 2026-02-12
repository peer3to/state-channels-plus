import {
    ScenarioRunner,
    Scenario,
    Transition,
    Event,
    Byzantine,
    Assert,
    PeerTestHarness
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Timeout Management
 *
 * Maps to: src/agreementManager/AgreementManager.ts
 *          src/utils/TimeoutManager.ts
 *          src/Clock.ts
 *
 * Tests timeout detection, forced timeouts, and network liveness during disconnections.
 */
describe("E2E: Timeouts", function () {
    describe("Basic Timeout Scenarios", function () {
        it("should handle timeout when next peer to write does not author a block", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ count: 2 }), // Peers 0 and 1 take their turn
                // Peer 2 should take turn but doesn't -> timeout triggers

                Event.reset(),
                Assert.disputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                }),
                Assert.didNotInitiateDispute({ peers: [2] }),
                Assert.disputeCommittedByAll({ expectedCountPerPeer: 1 }),
                Assert.noCalldataPosted()
            );
        });

        it("should demonstrate timeout creates disputes", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ count: 2 }), // First 2 peers take turn, 3rd doesn't

                Event.reset(),
                Assert.disputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                })
            );
        });
    });

    describe("Network Disconnection Timeouts", function () {
        it("should handle timeout when non-author peer disconnects (calldata posting)", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ rounds: 1 }), // All 3 peers write once
                Event.reset(),
                // Now it's peer 0's turn - disconnect peer 2 (non-author)
                Byzantine.disconnect(2),
                // Peer 0 authors but can't get peer 2's signature -> posts calldata
                // Then peer 1 writes to test liveness
                Transition.advanceState({ count: 2 }), // Peers 0 and 1 write (peer 2 disconnected)
                // Wait for calldata posting to happen during these writes
                Assert.calldataPosted()
            );
        });

        it("should handle timeout when author peer disconnects", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ rounds: 1 }), // Heights 0, 1, 2 - All 3 peers write once
                Transition.advanceState({ count: 1 }), // Height 3 - Peer 0 writes again
                Event.reset(),
                // Now it's peer 1's turn - disconnect them (author peer)
                Byzantine.disconnect(1),
                // Wait for timeout dispute from peers 0 and 2
                Assert.disputeInitiatedBy({
                    peers: [0, 2],
                    timeoutMs: 10000
                })
            );
        });
    });

    describe("Forced Timeout (Junk Calldata)", function () {
        it("should create forced timeout when peer posts junk calldata that is rejected", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ count: 2 }), // Peers 0 and 1 write
                Event.reset(),
                // Peer 2 posts invalid calldata on-chain
                Byzantine.postJunkCalldata(2),
                // Wait for other peers to detect the calldata
                Event.waitUntilEventOccurs("onBlockCalldataPosted"),
                // Assert forced timeout detection
                Assert.disputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                }),
                Assert.disputeCommittedByAll(),
                // Assert it's a forced timeout
                Assert.timeoutIsForced({ participant: 2 })
            );
        });

        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            // Combined scenario: valid block + junk calldata + timeout
            await ScenarioRunner.execute(
                Scenario.timeoutSetup(3),
                Transition.advanceState({ count: 2 }), // Peers 0 and 1 write
                Transition.peerWrite({ peer: 2 }), // Peer 2 writes valid block
                Event.reset(),
                Byzantine.postJunkCalldata(2, { heightOffset: 0 }), // For current height
                Event.waitUntilEventOccurs("onBlockCalldataPosted"),
                Event.reset(),
                Assert.disputeInitiatedBy({
                    peers: [1, 2],
                    timeoutMs: 10000
                })
            );
        });
    });

    describe("Network Liveness", function () {
        it("should maintain liveness when peer disconnects mid-transaction", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 2),
                Byzantine.disconnect(2), // Peer 2 goes offline
                Transition.advanceState({ count: 1 }), // Should work with peers 0,1
                Assert.peersInSync([0, 1]),
                Assert.noDisputes()
            );
        });
    });
});
