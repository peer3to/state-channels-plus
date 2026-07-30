import { expect } from "chai";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

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
    describe("Dispute Resolution and Fork Management", function () {
        it("should reduce invalid state transition disputes and create new fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const forkId = h.activeForkId!;
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitInvalidStateTransitionBlock(nextPeer.index);
            // settled fork -> the dispute is final, no auditing calldata posted
            await h.assert.dispute.initiatedAndCommitedWait({
                initiatedWithAuditingData: false
            });
            await h.dispute.resolveDisputeWait({ forkId });

            // the dispute bundled the offender's fraud proof into its multicall,
            // so applying it slashed them on-chain
            expect(await h.query.onChainSlashedParticipants()).to.include(
                nextPeer.address
            );
        });

        it("should post a dispute WITH auditing calldata on a pending-join fork", async function () {
            const h = TestSession.getHarness();
            // "calldata-backed" = the pending inbound join leaves the head
            // not-final-by-everyone, so the dispute's postedAuditingData is true
            // and dispute() takes the with-calldata upload. shorter evidence
            // time keeps the real resolve under budget
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { evidenceTime: 6 }
            });
            const offender = await h.query.getNextPeerToWrite();

            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait({
                initiatedWithAuditingData: true
            });
            await h.dispute.resolveDisputeWait({
                forkId: h.activeForkId!,
                forkSettleTimeoutMs: 20000,
                syntheticOnChainParticipants: 1
            });

            expect(await h.query.onChainSlashedParticipants()).to.include(
                offender.address
            );
        });

        it("should post updated state snapshot after fork resolution", async function () {
            const h = TestSession.getHarness();
            await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateWait();

            await h.assert.sync.onlyHonestPeersInSync();
            await h.transition.fromHonestPeersOnly((c) => c.add(1));
            h.event.resetEventSpies();
            const expectedSnapshot2 = await h.transition.postSnapshot({
                peerIndex: 0
            });

            await h.assert.snapshot.localSnapshotsChangedDetached({
                expectedSnapshot: expectedSnapshot2
            });
            return;
        });
    });

    describe("Writer Timeout on a Pending-Join Fork", function () {
        // the DisputeManager branch it exercises (no fraud proof + calldata ->
        // uploadDisputeWithCalldata) is pinned directly by
        // test/unit/DisputeManager.test.ts; enable this workflow regression once
        // the reduction race below is handled.
        // skipped: flaky - exposes a real product bug (~10% of runs), not a test
        // defect. see the KNOWN RACE note below: a losing peer's reduceAndFinalize
        // reverts ErrorDisputeInboundMessageBlocksInvalid on the reduction path and
        // it's rethrown into a fire-and-forget promise -> unhandled detached
        // rejection.
        // https://trello.com/c/MUwszX7B
        it.skip("should dispute a timed-out writer on a pending-join fork with auditing calldata", async function () {
            const h = TestSession.getHarness();

            // a pending inbound join leaves the head not-final-by-everyone, so a
            // dispute here carries postedAuditingData=true (auditing calldata)
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { chainFallbackTime: 2 }
            });

            // no block is produced -> the next writer's turn lapses -> the honest
            // peers dispute the timed-out writer. a timeout has no fraud proof, so
            // on this calldata-backed fork dispute() takes the no-multicall +
            // uploadDisputeWithCalldata path (the branch this test covers)
            const darkWriter = await h.query.getNextPeerToWrite();
            const disputers = h.peers
                .filter((p) => p.index !== darkWriter.index)
                .map((p) => p.index);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: disputers,
                expectedCount: disputers.length,
                initiatedWithAuditingData: true, // the calldata upload we wanted
                timeoutMs: 30000
            });

            // after commit every honest peer runs a fire-and-forget reduction to
            // settle the fork; one wins. KNOWN RACE: a losing peer precomputed its
            // reduce, but the on-chain reduceAndFinalize re-reduces against an
            // advanced window and reverts ErrorDisputeInboundMessageBlocksInvalid;
            // the reduction path doesn't handle that error -> it rethrows into a
            // fire-and-forget promise -> unhandled detached rejection (~10% of runs)
            await h.dispute.resolveDisputeWait({
                forkId: h.activeForkId!,
                honestPeerIndices: disputers,
                forkSettleTimeoutMs: 25000,
                assertMaliciousRemoved: false,
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("Fraud Proof Detection", function () {
        it("should kill a spam dispute with no legitimate enforcement basis", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });
            const forkId = h.activeForkId!;

            // Post a dispute from peer 1 that is internally valid but has no legitimate
            // enforcement basis: no timeout, no on-chain slashes, no self-removal.
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.InvalidDisputeReason
            });

            await h.dispute.resolveDisputeWait({
                forkId,
                forkSettleTimeoutMs: 15000
            });
        });

        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            await h.tamper.postTamperedDispute(
                3,
                (dispute, _disputeConfirmation, auditingData) => {
                    if (!auditingData) {
                        throw new Error("Expected dispute auditing data");
                    }
                    if (!dispute.postedAuditingData) {
                        throw new Error(
                            "Expected calldata-backed dispute for partial auditing data test"
                        );
                    }
                    if (dispute.input.stateProof.milestones.length === 0) {
                        throw new Error(
                            "Expected milestone-backed state proof"
                        );
                    }

                    auditingData.milestoneSnapshots = [];
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                forkSettleTimeoutMs: 15000,
                syntheticOnChainParticipants: 1
            });
        });

        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });
            const forkId = h.activeForkId!;
            await h.byzantine.tamperedDisputeDoubleFault(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                forkSettleTimeoutMs: 20000
            });
        });
    });

    describe("Partial Syncing via Dispute Validation", function () {
        it("recovers an expired posted-data dispute and reduces from persisted proof data", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { evidenceTime: 3 }
            });
            const disputedForkId = h.activeForkId;
            if (!disputedForkId) throw new Error("Expected an active fork");

            const nextPeer = await h.query.getNextPeerToWrite();
            // Keep the next block producer connected so the setup transition
            // advances; account allocation can change which index owns the turn.
            const missedPeerIndex = [2, 3, 0].find(
                (peerIndex) => peerIndex !== nextPeer.index
            );
            if (missedPeerIndex === undefined) {
                throw new Error("Expected a non-producing peer to disconnect");
            }
            const connectedPeerIndices = h.peers
                .map((peer) => peer.index)
                .filter((peerIndex) => peerIndex !== missedPeerIndex);
            for (const peer of h.peers) {
                await h.control(peer).stub.stubHoldReductionTasks().request();
            }
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                missedPeerIndex,
                {
                    passFirst: false
                }
            );
            await h
                .control(h.getPeer(missedPeerIndex))
                .stub.stubSuppressDisputeInitiation()
                .request();
            await h.byzantine.disconnect(missedPeerIndex);
            await h.transition.advanceState({
                waitForPeers: connectedPeerIndices
            });
            await h.byzantine.submitDoubleSignBlock(1);
            await h.event.waitForDisputeFromAnyPeer(connectedPeerIndices);
            const initiatingPeer = connectedPeerIndices
                .map((peerIndex) => h.getPeer(peerIndex))
                .find(
                    (peer) =>
                        (peer.eventSpies.onInitiatingDispute?.callCount ?? 0) >
                        0
                );
            if (!initiatingPeer)
                throw new Error("Expected a dispute initiator");
            const initiatedDispute =
                initiatingPeer.eventSpies.onInitiatingDispute!.lastCall.args[1];
            if (!initiatedDispute.postedAuditingData) {
                throw new Error("Expected a calldata-backed dispute");
            }
            await h.event.waitForPeers(
                "onDisputeCommitted",
                connectedPeerIndices,
                1,
                {
                    mode: "atLeast",
                    timeoutMs: h.event.protocolEventTimeoutMs(0)
                }
            );

            await sleep(h.event.evidencePeriodWaitMs());
            // The peer missed the event while disconnected, then reconnects so
            // event recovery can fetch the committed dispute payloads.
            await h.network.connectPeers([missedPeerIndex]);
            await restoreEvents(false);
            const missedPeer = h.getPeer(missedPeerIndex);
            const recoveredCount = await h
                .control(missedPeer)
                .dispute.recoverCommittedDisputes(disputedForkId)
                .request();
            if (recoveredCount < 1) {
                throw new Error("Expected at least one recovered dispute");
            }
            await h.assert.storage.storedDisputeConfirmationsWait({
                peerIndices: [missedPeerIndex],
                forkId: disputedForkId,
                timeoutMs: 10000
            });

            for (const peerIndex of connectedPeerIndices) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.restoreReductionTasks(false)
                    .request();
            }
            h.event.resetEventSpies();
            await h
                .control(missedPeer)
                .stub.restoreReductionTasks(true)
                .request();
            const reducedForkId = await h
                .control(missedPeer)
                .dispute.awaitReduction(disputedForkId)
                .request();
            if (!reducedForkId || reducedForkId === disputedForkId) {
                throw new Error(
                    "Expected the recovered expired dispute to reduce to a new fork"
                );
            }

            // The recovered peer posts the new-fork snapshot, which starts
            // reduction from the snapshot event on the connected peers. The
            // forwarded hook fires only after each real handler has settled.
            await h.event.waitForPeers(
                "onStateSnapshotUpdated",
                connectedPeerIndices,
                1,
                { mode: "atLeast", timeoutMs: 20000 }
            );

            const hostErrors = await h.quiesceHosts();
            if (hostErrors.length > 0) throw hostErrors[0];
        });

        it("should have missing state Storage when peer receives dispute with blocks it doesn't have", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();
            await h.byzantine.stubBroadcast(1);
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
        });

        it("should handle valid dispute when validating peer is missing snapshot data", async function () {
            // TODO
            // This is NOT a good test, since peer 2 will try and timeout peer 0 and while doing so will fetch on-chain block (and run it through the pipeline) while checking race condition (calldata posted)
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.byzantine.stubCalldataHandler(2);
            await h.contextApi.storeSnapshotCount(2, "before_isolation");
            await h.byzantine.disconnect(2);
            h.event.resetEventSpies();

            await h.transition.advanceState({ waitForPeers: [0, 1], count: 2 });
            await h.event.waitForDisputeFromAnyPeer([0, 1]);
            await h.assert.snapshot.snapshotCountIncreasedSince(
                2,
                "before_isolation"
            );
            await h.assert.storage.honestPeersStoredBlockAndStateWait({
                height: 1
            });
            await h.byzantine.restoreCalldataHandler(2);
        });
    });
});
