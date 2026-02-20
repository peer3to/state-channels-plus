import { Codec, Type } from "@/utils";
import {
    ScenarioRunner,
    Scenario,
    Byzantine,
    Assert,
    Event,
    Transition,
    PeerTestHarness,
    Context,
    Lifecycle
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Dispute Management
 *
 * Maps to: src/disputeManager/DisputeManager.ts
 *          src/stateManager/DisputeValidationService.ts
 *          src/stateManager/ValidationService.ts
 *          src/stateManager/validationStrategy/DisputeValidationStrategy.ts
 *
 * Tests dispute creation, validation, resolution, and fraud proof mechanisms.
 */
describe("E2E: Dispute Manager", function () {
    describe("Dispute Initiation", function () {
        it("should create dispute for double-sign detected", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 2),
                Byzantine.doubleSignFrom(1), // Peer 1 double-signs
                Assert.disputeInitiatedByPeers({ peers: [0, 2] }), // Peers 0,2 detect
                Assert.disputeCommittedByPeers()
            );
        });

        it("should create dispute for invalid state transition", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 2),
                Byzantine.invalidTransitionFrom(2), // Peer 2 submits invalid
                Assert.disputeInitiatedByPeers({ peers: [0, 1] }),
                Assert.disputeCommittedByPeers({ expectedCount: 2 })
            );
        });

        it("should dispute forged inbound message blocks", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 2),
                Event.reset(),
                Byzantine.forgedInboundMessageFromNext(),
                Assert.disputeInitiatedByPeers(),
                Assert.disputeCommittedByPeers({ expectedCount: 2 })
            );
        });

        it("should handle double-sign from different peer configurations", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(4, 3),
                Byzantine.doubleSignFrom(2), // Peer 2 attacks
                Assert.disputeInitiatedByPeers({ peers: [0, 1, 3] }) // Others detect
            );
        });
    });

    describe("Dispute Resolution and Fork Management", function () {
        it("should reduce invalid state transition disputes and create new fork", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(4, 2, {
                    timeConfig: {
                        p2pTime: 3,
                        agreementTime: 2,
                        chainFallbackTime: 2,
                        evidenceTime: 3
                    }
                }),
                Assert.peersInSync(),
                Event.reset(),

                Context.captureOriginalFork(),
                Byzantine.invalidTransitionFromNext(),
                Assert.disputeCommittedByPeers({
                    expectedCount: 3
                }),
                Assert.forkChanged({ minHonestPeers: 3 })
            );
        });

        it.only("should post updated state snapshot after fork resolution", async function () {
            this.timeout(90000); // Increase timeout for this test
            await ScenarioRunner.execute(
                // Use the composed scenario (setup + fork resolution + first snapshot post)
                Scenario.fourPeersDisputeResolutionAndSnapshotUpdate({
                    timeConfig: {
                        p2pTime: 1,
                        agreementTime: 2,
                        chainFallbackTime: 2,
                        evidenceTime: 3
                    }
                }),

                // Do 3 transitions on the reduced fork
                Transition.fromHonestPeersOnly((c) => c.add(1)),
                Transition.fromHonestPeersOnly((c) => c.leaveChannel()),
                Transition.fromHonestPeersOnly((c) => c.add(3)),

                // Verify honest peers are in sync
                Assert.onlyHonestPeersInSync(),
                Event.reset(),

                // Post snapshot again (same-fork update)
                Transition.postSnapshot({ peerIndex: 0 }),

                // Wait for snapshot update events
                Event.waitForHonestPeers("onStateSnapshotUpdated", 1, {
                    mode: "atLeast"
                }),

                // Verify on-chain snapshot matches latest local snapshot
                Assert.snapshotMatchesLocal({ peerIndex: 0 }),

                // Verify malicious peer is excluded from rotation
                Assert.maliciousPeerExcluded()
            );
        });
    });

    describe("Fraud Proof Detection", function () {
        it.only("should reject dispute with incorrect auditing data commitment", async function () {
            await ScenarioRunner.execute(
                Scenario.preDisputeSetup(),

                // Byzantine: Peer 1 posts tampered dispute
                Byzantine.postTamperedDisputeAuditingData(1),

                // Wait: Dispute gets killed by validation
                Event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                }),
                // Assert: Fraud proof stored
                Assert.latestDisputeFraudProofStored(),
                // Lifecycle.triggerUploadLogs(),
                Lifecycle.resolveDispute(1),
                Assert.forkChanged()
            );
        });

        it("should reject timeout dispute when timedout participant is not next to write", async function () {
            await ScenarioRunner.execute(
                Scenario.preDisputeSetup(),

                // Byzantine: Peer 0 posts tampered timeout dispute accusing wrong peer
                Byzantine.postTamperedDisputeTimeout({
                    submitterIndex: 0,
                    wrongParticipantIndex: 1,
                    blockHeight: 2
                }),

                // Assert: Fraud proof stored and fork unchanged
                Assert.latestDisputeFraudProofStored(),
                Assert.forkUnchanged()
            );
        });

        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            await ScenarioRunner.execute(
                Scenario.preDisputeSetup(),

                // Byzantine: Peer 1 posts tampered dispute with unknown snapshot reference
                Byzantine.tamperedDisputePartialAuditing(1),

                // Wait: Dispute gets killed by validation
                Event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                }),
                // Assert: Fraud proof stored and fork unchanged
                Assert.latestDisputeFraudProofStored(),
                Assert.forkUnchanged()
            );
        });

        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            await ScenarioRunner.execute(
                Scenario.preDisputeSetup(),

                // Byzantine: Peer 1 posts tampered dispute with BOTH invalid commitment and state proof
                Byzantine.tamperedDisputeDoubleFault(1),

                // Wait: Dispute gets killed by validation
                Event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                }),
                // Assert: Fraud proof stored and fork unchanged
                Assert.latestDisputeFraudProofStored(),
                Assert.forkUnchanged()
            );
        });

        it("should reject dispute when auditing data commitment is valid but state proof is invalid", async function () {
            await ScenarioRunner.execute(
                Scenario.preDisputeSetup(),

                // Byzantine: Peer 1 posts tampered dispute with ONLY invalid state proof
                Byzantine.tamperedDisputeInvalidStateProof(1),

                // Wait: Dispute gets killed by validation
                Event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                }),
                // Assert: Fraud proof stored and fork unchanged
                Assert.latestDisputeFraudProofStored(),
                Assert.forkUnchanged()
            );
        });
    });

    describe("Re-Dispute Detection", function () {
        it("should redispute a tampered state proof that corrupts the first signed block height", async function () {
            await ScenarioRunner.execute(
                // Use composed scenario: 4 peers, peer 3 disconnected, 1 transaction synced
                Scenario.readyForRedispute(),

                // Setup interception: when peer 0 constructs a dispute, tamper it
                Byzantine.stubDisputeConstruction({
                    peerIndex: 0,
                    tamperFn: async (dispute) => {
                        // Corrupt first signed block's transaction count
                        const stateProof = dispute.input.stateProof;

                        if (stateProof.signedBlocks.length === 0) {
                            throw new Error(
                                "Expected signedBlocks in state proof"
                            );
                        }

                        const firstBlock = Codec.decode(
                            stateProof.signedBlocks[0].encodedBlock,
                            Type.Block
                        );

                        // Corrupt the transaction count by adding 5
                        firstBlock.transaction.header.transactionCnt =
                            BigInt(
                                firstBlock.transaction.header.transactionCnt
                            ) + 5n;

                        stateProof.signedBlocks[0].encodedBlock = Codec.encode(
                            firstBlock,
                            Type.Block
                        );
                    }
                }),

                // Peer 1 submits invalid block (triggers disputes from peer 0 and peer 2)
                Byzantine.invalidTransitionFrom(1),

                // Peer 2 should initiate TWO disputes:
                // 1. One for peer 1's invalid block
                // 2. One for peer 0's tampered dispute
                Event.waitForPeerDisputes(2, 2, { timeoutMs: 15000 }),

                // Verify peer 2 stored fraud proof for peer 0's tampered dispute
                Assert.fraudProofStoredForTamperedDispute(2),

                // Cleanup: restore constructDispute interception
                Byzantine.restoreDisputeConstruction(0)
            );
        });
    });

    describe("Partial Syncing via Dispute Validation", function () {
        it("should sync missing state via validStateProofButNotSynced when peer receives dispute with blocks it doesn't have", async function () {
            await ScenarioRunner.execute(
                // Setup: 3 peers, 1 state transition
                Scenario.startChannel(3, 1),
                // Peer 1 has produces a block that others don't have
                Scenario.peerWithUnbroadcastedBlock(1),

                // Verify peer 1 is ahead (has the block that wasn't broadcast)
                Assert.peerBlockHeightGreaterThan(1, 2),
                Assert.blockHeight({ expectedHeight: 0, peerIndices: [0, 2] }),
                Assert.blockHeight({ expectedHeight: 1, peerIndices: [1] }),

                // Peer 0 submits invalid transition (triggers disputes)
                Byzantine.invalidTransitionFrom(0),

                // Wait for disputes to be committed
                Event.waitForPeers("onDisputeCommitted", [1, 2], 2, {
                    mode: "atLeast"
                }),

                // Peer 2 should sync the missing block via peer 1's dispute
                Assert.peersInSync({ peerIndices: [1, 2] })
            );
        });

        it("should handle valid dispute when validating peer is missing snapshot data", async function () {
            await ScenarioRunner.execute(
                // Setup: 3 peers, peer 2 isolated (can't sync from P2P or chain)
                Scenario.peer2Isolated(),

                // Submit transaction without peer 2 (peer 2 won't receive it)
                // Block stays UNFINALIZED (in signedBlocks, not milestones)
                Transition.validWithoutPeer(2, (c) => c.add(100)),

                // Wait for timeout dispute from peer 0 or 1
                // Peer 2 will validate this dispute with isPartial = true
                Event.waitForDisputeFromAnyPeer([0, 1]),

                // Verify peer 2 resynced via validStateProofButNotSynced
                // When peer 2 validates the dispute with isPartial = true,
                // it should sync by applying the signed blocks from the state proof
                Assert.snapshotCountIncreasedSince(2, "before_isolation"),

                // Cleanup: restore calldata handler
                Byzantine.restoreCalldataHandler(2)
            );
        });
    });
});
