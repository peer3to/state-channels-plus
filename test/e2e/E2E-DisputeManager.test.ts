import { Codec, Type } from "@/utils";
import { TestSession, PeerTestHarness } from "@test/harness";

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
            const h = TestSession.getHarness();
            await h.channel.start(3, 2);
            await h.byzantine.submitDoubleSignBlock(1, {
                forkId: h.activeForkId!
            });
            await h.assert.dispute.disputeInitiatedByPeers({
                peersIndices: [0, 2]
            });
            await h.assert.dispute.disputeCommittedByPeers();
        });

        it("should create dispute for invalid state transition", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(3, 2);
            await h.byzantine.submitInvalidStateTransitionBlock(2, {
                forkId: h.activeForkId!
            });
            await h.assert.dispute.disputeInitiatedByPeers({
                peersIndices: [0, 1]
            });
            await h.assert.dispute.disputeCommittedByPeers({
                expectedCount: 2
            });
        });

        it("should dispute forged inbound message blocks", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(3, 2);
            h.event.resetEventSpies();
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitForgedInboundMessageBlock(nextPeer.index, {
                forkId: h.activeForkId!
            });
            await h.assert.dispute.disputeInitiatedByPeers({});
            await h.assert.dispute.disputeCommittedByPeers({
                expectedCount: 2
            });
        });

        it("should handle double-sign from different peer configurations", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(4, 3);
            await h.byzantine.submitDoubleSignBlock(2, {
                forkId: h.activeForkId!
            });
            await h.assert.dispute.disputeInitiatedByPeers({
                peersIndices: [0, 1, 3]
            });
        });
    });

    describe("Dispute Resolution and Fork Management", function () {
        it("should reduce invalid state transition disputes and create new fork", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(4, 2, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            await h.assert.sync.peersInSync();
            h.event.resetEventSpies();

            h.contextApi.captureOriginalFork();
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitInvalidStateTransitionBlock(
                nextPeer.index,
                {
                    forkId: h.activeForkId!
                }
            );
            await h.assert.dispute.disputeCommittedByPeers({
                expectedCount: 3
            });
            await h.assert.sync.forkChanged({
                originalForkId: h.context.originalForkId!,
                minHonestPeers: 3
            });
        });

        it.only("should post updated state snapshot after fork resolution", async function () {
            this.timeout(90000); // Increase timeout for this test
            const h = TestSession.getHarness();
            await h.channel.start(4, 2, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            await h.assert.sync.peersInSync();
            await h.scenario.disputeAndResolve({
                maliciousPeerIndex: 2,
                disputesCommittedMode: "atLeast",
                assertMaliciousRemoved: false
            });
            await h.transition.postSnapshot({ peerIndex: 0 });
            await h.assert.snapshot.onChainSnapshotOnFork();

            await h.transition.fromHonestPeersOnly((c) => c.add(1));
            await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
            await h.transition.fromHonestPeersOnly((c) => c.add(3));

            await h.assert.sync.onlyHonestPeersInSync();
            h.event.resetEventSpies();
            await h.transition.postSnapshot({ peerIndex: 0 });

            const honest = h.context.honestPeerIndices || [];
            await h.event.waitForEventCounts(
                "onStateSnapshotUpdated",
                honest.map((peerId) => ({ peerId, expectedCount: 1 })),
                10000,
                { mode: "atLeast" }
            );

            await h.assert.snapshot.snapshotMatchesLocal({ peerIndex: 0 });
            await h.assert.sync.maliciousPeerExcluded();
        });
    });

    describe("Fraud Proof Detection", function () {
        it.skip("should reject dispute with incorrect auditing data commitment", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.postTamperedDisputeAuditingData(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.latestDisputeFraudProofStored();
            await h.dispute.resolveDispute({
                maliciousPeerIndex: 1,
                forkId: h.activeForkId!
            });
            await h.assert.sync.forkChanged({
                originalForkId: h.context.originalForkId || h.activeForkId!
            });
        });

        it("should reject timeout dispute when timedout participant is not next to write", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.postTamperedDisputeTimeout({
                submitterIndex: 0,
                wrongParticipantIndex: 1,
                blockHeight: 2
            });
            await h.assert.dispute.latestDisputeFraudProofStored();
            h.assert.sync.forkUnchanged();
        });

        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputePartialAuditing(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.latestDisputeFraudProofStored();
            h.assert.sync.forkUnchanged();
        });

        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputeDoubleFault(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.latestDisputeFraudProofStored();
            h.assert.sync.forkUnchanged();
        });

        it("should reject dispute when auditing data commitment is valid but state proof is invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputeInvalidStateProof(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.latestDisputeFraudProofStored();
            h.assert.sync.forkUnchanged();
        });
    });

    describe("Re-Dispute Detection", function () {
        it("should redispute a tampered state proof that corrupts the first signed block height", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.channel.start(4, 0, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 1,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            });
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ txFn: (c) => c.add(1) });
            await h.assert.sync.peersInSync({ peerIndices: [0, 1, 2] });
            h.event.resetEventSpies();

            h.byzantine.stubDisputeConstruction({
                peerIndex: 0,
                tamperFn: async (dispute) => {
                    const stateProof = dispute.input.stateProof;

                    if (stateProof.signedBlocks.length === 0) {
                        throw new Error("Expected signedBlocks in state proof");
                    }

                    const firstBlock = Codec.decode(
                        stateProof.signedBlocks[0].encodedBlock,
                        Type.Block
                    );

                    firstBlock.transaction.header.transactionCnt =
                        BigInt(firstBlock.transaction.header.transactionCnt) +
                        5n;

                    stateProof.signedBlocks[0].encodedBlock = Codec.encode(
                        firstBlock,
                        Type.Block
                    );
                }
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1, {
                forkId: h.activeForkId!
            });

            await h.event.waitForPeerDisputes(2, 2, { timeoutMs: 15000 });
            await h.assert.dispute.fraudProofStoredForTamperedDispute(2);
            h.byzantine.restoreDisputeConstruction(0);
        });
    });

    describe("Partial Syncing via Dispute Validation", function () {
        it("should sync missing state via validStateProofButNotSynced when peer receives dispute with blocks it doesn't have", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(3, 1);
            await h.assert.sync.peersInSync();
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

            await h.byzantine.submitInvalidStateTransitionBlock(0, {
                forkId: h.activeForkId!
            });

            await h.event.waitForPeers("onDisputeCommitted", [1, 2], 2, {
                mode: "atLeast"
            });

            await h.assert.sync.peersInSync({ peerIndices: [1, 2] });
        });

        it("should handle valid dispute when validating peer is missing snapshot data", async function () {
            const h = TestSession.getHarness();
            await h.channel.start(3, 0, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            });
            h.byzantine.stubCalldataHandler(2);
            h.contextApi.storeSnapshotCount(2, "before_isolation");
            await h.byzantine.disconnect(2);
            h.event.resetEventSpies();

            await h.transition.validWithoutPeer(2, (c) => c.add(100));
            await h.event.waitForDisputeFromAnyPeer([0, 1]);
            await h.assert.snapshot.snapshotCountIncreasedSince(
                2,
                "before_isolation"
            );
            h.byzantine.restoreCalldataHandler(2);
        });
    });
});
