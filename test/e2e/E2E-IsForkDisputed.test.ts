import {
    ScenarioRunner,
    Scenario,
    Assert,
    Event,
    RPC,
    PeerTestHarness,
    Time
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Fork Dispute Detection
 *
 * Maps to: src/rpc/services/isForkDisputedService/IsForkDisputedService.ts
 *          src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts
 *
 * Tests the fork dispute acknowledgment mechanism and peer disconnection logic.
 */
describe("E2E: Is Fork Disputed", function () {
    describe("Dispute Acknowledgment Broadcasting", function () {
        it("should broadcast acknowledgment request and receive responses from all peers", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannelWithDispute({
                    numPeers: 3,
                    numBlocks: 2,
                    byzantinePeer: 1
                }),

                RPC.requestDisputeAcknowledgment({ peerIndex: 0 }),

                Assert.allPeersAcknowledgedDispute({
                    requestingPeer: 0,
                    excludePeers: [1]
                })
            );
        });

        it("should successfully acknowledge genuinely disputed fork", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannelWithDispute({
                    numPeers: 3,
                    numBlocks: 2,
                    byzantinePeer: 1
                }),

                RPC.requestDisputeAcknowledgment({ peerIndex: 0 }),

                Assert.allPeersAcknowledgedDispute({
                    requestingPeer: 0,
                    excludePeers: [1]
                })
            );
        });

        it("should ignore duplicate dispute acknowledgment requests", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannelWithDispute({
                    numPeers: 3,
                    numBlocks: 2,
                    byzantinePeer: 1
                }),

                // First request
                RPC.requestDisputeAcknowledgment({ peerIndex: 0 }),

                Assert.allPeersAcknowledgedDispute({
                    requestingPeer: 0,
                    excludePeers: [1]
                }),

                // Second request should be ignored (idempotent)
                Assert.duplicateDisputeRequestIgnored({ peerIndex: 0 }),

                // Should still have all acknowledgments
                Assert.allPeersAcknowledgedDispute({
                    requestingPeer: 0,
                    excludePeers: [1]
                })
            );
        });

        it("should disconnect peer sending duplicate acknowledgment responses", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannelWithDispute({
                    numPeers: 3,
                    numBlocks: 2,
                    byzantinePeer: 1
                }),

                // Send first response (valid)
                RPC.sendDuplicateAcknowledgmentResponse({
                    respondingPeer: 0,
                    requestingPeer: 2
                }),

                Assert.firstAcknowledgmentRecorded({
                    respondingPeer: 0,
                    requestingPeer: 2
                }),

                // Send duplicate response (should trigger disconnection)
                RPC.sendDuplicateAcknowledgmentResponse({
                    respondingPeer: 0,
                    requestingPeer: 2
                }),

                // Peer 0 should disconnect peer 2 for duplicate response
                Assert.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 0 // Already disconnected from peer 1 (byzantine)
                })
            );
        });

        it("should disconnect non-responding peers after acknowledgment timeout", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3, {
                    timeConfig: { agreementTime: 1 }
                }),

                // Request acknowledgment for fake fork with spied disconnect
                RPC.requestFakeDisputeWithSpiedDisconnect({
                    requestingPeer: 0
                }),

                // Wait for timeout (2 * agreementTime = 2 seconds)
                Time.wait(2500),

                // Peer 0 should have disconnected non-responding peers
                Assert.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 0 // Both peers timed out
                })
            );
        });
    });

    describe("Byzantine Peer Detection", function () {
        it("should disconnect peer building on acknowledged disputed fork", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannelWithDispute({
                    numPeers: 3,
                    numBlocks: 2,
                    byzantinePeer: 1
                }),

                RPC.requestDisputeAcknowledgment({ peerIndex: 0 }),

                Assert.allPeersAcknowledgedDispute({
                    requestingPeer: 0,
                    excludePeers: [1]
                }),

                RPC.simulateBuildOnDisputedFork({
                    buildingPeer: 2,
                    observingPeer: 0
                }),

                // Peer 0 disconnects both peer 1 (byzantine) and peer 2 (building on disputed fork)
                // Note: activeChannelWithDispute already causes peer 0 to disconnect peer 1
                // So after disconnecting peer 2, peer 0 has 0 connections
                Assert.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 0
                })
            );
        });

        it("should disconnect peer requesting acknowledgment of non-disputed fork", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannel(3, 2),
                Event.reset(),

                RPC.sendFakeDisputeRequest({
                    fromPeer: 0,
                    toPeer: 1
                }),

                // Peer 1 should disconnect peer 0, leaving only 1 connection (to peer 2)
                Assert.peerDisconnectedFrom({
                    peerIndex: 1,
                    expectedFinalCount: 1
                })
            );
        });
    });
});
