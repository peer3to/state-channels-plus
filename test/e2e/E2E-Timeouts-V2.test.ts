import {
    ScenarioRunner,
    Scenario,
    Event,
    Byzantine,
    Assert,
    composeBlocks,
    PeerTestHarness
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");
describe("E2E: Timeouts (V2 - High-Level DSL)", function () {
    describe("Basic Timeout Scenarios", function () {
        it("should handle timeout when next peer to write does not author a block", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutChannel(3),
                Scenario.peersWrite(2), // Peers 0 and 1 take their turn
                // Peer 2 should take turn but doesn't -> timeout triggers

                Event.reset(),
                Event.waitUntilDisputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                }),
                Event.assertDidNotInitiateDispute({ peers: [2] }),
                Event.waitUntilDisputeCommitted(10000),
                Event.assertDisputeCommittedByAll({ expectedCountPerPeer: 1 }),
                Event.assertNoCalldataPosted()
            );
        });

        it("should demonstrate timeout creates disputes", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutChannel(3),
                Scenario.peersWrite(2), // First 2 peers take turn, 3rd doesn't

                Event.reset(),
                Event.waitUntilDisputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                })
            );
        });
    });

    describe("Network Disconnection Timeouts", function () {
        it("should handle timeout when non-author peer disconnects (calldata posting)", async function () {
            // Setup: 3 peers, all write once
            const { harness, cleanup } =
                await ScenarioRunner.executeWithCleanup(
                    Scenario.timeoutChannel(3),
                    Scenario.fullRound(), // All 3 peers write once
                    Event.reset()
                );

            // Now it's peer 0's turn - disconnect peer 2 (non-author)
            await harness.peers[2].p2pInstance.p2pSigner.p2pManager.disconnectAll();

            // Peer 0 authors but can't get peer 2's signature -> posts calldata
            await harness.transitionActions.submit(
                harness.peers[0],
                (contract) => contract.add(100),
                { waitForPeers: [0, 1] }
            );

            // Wait for calldata posting
            await composeBlocks(harness, Event.waitUntilCalldataPosted(5000));

            // Test liveness: Peer 1 should be able to write
            await harness.transitionActions.submit(
                harness.peers[1],
                (contract) => contract.add(200),
                { waitForPeers: [0, 1] }
            );

            await cleanup();
        });

        it("should handle timeout when author peer disconnects", async function () {
            // Setup: All 3 peers write once, peer 0 writes again
            const { harness, cleanup } =
                await ScenarioRunner.executeWithCleanup(
                    Scenario.timeoutChannel(3),
                    Scenario.fullRound(), // Heights 0, 1, 2
                    Scenario.peerWrites({ peer: 0, value: 100 }), // Height 3
                    Event.reset()
                );

            // Now it's peer 1's turn - disconnect them (author peer)
            await harness.peers[1].p2pInstance.p2pSigner.p2pManager.disconnectAll();

            // Wait for timeout dispute from peers 0 and 2
            await composeBlocks(
                harness,
                Event.waitUntilDisputeInitiatedBy({
                    peers: [0, 2],
                    timeoutMs: 10000
                })
            );

            await cleanup();
        });
    });

    describe("Forced Timeout (Junk Calldata)", function () {
        it("should create forced timeout when peer posts junk calldata that is rejected", async function () {
            await ScenarioRunner.execute(
                Scenario.timeoutChannel(3),
                Scenario.peersWrite(2), // Peers 0 and 1 write
                Event.reset(),

                // Peer 2 posts invalid calldata on-chain
                Byzantine.postJunkCalldata(2),

                // Wait for other peers to detect the calldata
                Event.waitUntilEventOccurs("onBlockCalldataPosted", 5000),

                // Wait for forced timeout detection
                Event.waitUntilDisputeInitiatedBy({
                    peers: [0, 1],
                    timeoutMs: 10000
                }),
                Event.waitUntilDisputeCommitted(10000),

                // Assert it's a forced timeout
                Assert.timeoutIsForced({ participant: 2 })
            );
        });

        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            // Combined scenario: valid block + junk calldata + timeout
            await ScenarioRunner.execute(
                Scenario.timeoutChannel(3),
                Scenario.peersWrite(2), // Peers 0 and 1 write
                Scenario.peerWrites({ peer: 2, value: 1 }), // Peer 2 writes valid block
                Event.reset(),
                Byzantine.postJunkCalldata(2, { heightOffset: 0 }), // For current height
                Event.waitUntilEventOccurs("onBlockCalldataPosted", 5000),
                Event.reset(),
                Event.waitUntilDisputeInitiatedBy({
                    peers: [1, 2],
                    timeoutMs: 15000
                })
            );
        });
    });

    describe("Network Liveness", function () {
        it("should maintain liveness when peer disconnects mid-transaction", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannel(3, 2),
                Byzantine.disconnect(2), // Peer 2 goes offline
                Scenario.peersWrite(1), // Should work with peers 0,1
                Assert.peersInSync([0, 1]),
                Event.assertNoDisputes()
            );
        });
    });
});
