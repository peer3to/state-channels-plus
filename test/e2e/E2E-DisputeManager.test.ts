import { expect } from "chai";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { hash, tryDecodeCustomError } from "@/utils";
import { TestSession, PeerTestHarness, DisputeTampering } from "@test/harness";

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
    describe("Dispute Resolution and Fork Management", function () {
        it("should reduce invalid state transition disputes and create new fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitInvalidStateTransitionBlock(nextPeer.index);
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.dispute.resolveDisputeWait();
        });

        it("should post updated state snapshot after fork resolution", async function () {
            const h = TestSession.getHarness();
            await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateDetached();

            await h.transition.fromHonestPeersOnly((c) => c.add(1));
            await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
            await h.transition.fromHonestPeersOnly((c) => c.add(3));

            await h.assert.sync.onlyHonestPeersInSync();
            await await h.assert.sync.onChainSnapshotAndPeersSameForkWait(); // await this to be sure that the post snapshot event bellow is not triggered by the detached update from above
            h.event.resetEventSpies();
            const expectedSnapshot2 = await h.transition.postSnapshot({
                peerIndex: 0
            });

            await h.assert.snapshot.onChainSnapshotChangedDetached({
                expectedSnapshot: expectedSnapshot2
            });
            return;
        });
    });

    describe("Fraud Proof Detection", function () {
        it("should kill a spam dispute with no legitimate enforcement basis", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

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

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });

        it("a dispute submitted with no calldata should not be killed even if the auditing data hash is tampered", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(
                0,
                DisputeTampering.tamperAuditingDataHash,
                {
                    autoRestore: true,
                    markMalicious: false
                }
            );

            // Peer 1 double-signs
            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait();

            h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                maliciousPeerIndex: 1
            });

            await h.dispute.resolveDisputeWait();

            // Peer 1 (double-signer) removed.
            await h.assert.sync.maliciousPeerExcluded();
            // peer 0 (tampered hash) and peer 2 remain
            await h.assert.sync.participantCount({ expectedCount: 2 });
        });

        it("should reject dispute submission when posted auditing data hash does not match submitted auditing data", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash("0x42");
                });
                expect.fail(
                    "Expected ErrorAuditingDataHashMismatch to be thrown"
                );
            } catch (error: any) {
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "ErrorAuditingDataHashMismatch"
                );
            }
        });

        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputePartialAuditing(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached();
            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });

        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(3, {
                timeConfig: { evidenceTime: 6 }
            });
            await h.byzantine.tamperedDisputeDoubleFault(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached();
            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 20000 });
        });
    });

    describe("Partial Syncing via Dispute Validation", function () {
        it("should have missing state Storage when peer receives dispute with blocks it doesn't have", async function () {
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
        });

        it("should handle valid dispute when validating peer is missing snapshot data", async function () {
            // TODO
            // This is NOT a good test, since peer 2 will try and timeout peer 0 and while doing so will fetch on-chain block (and run it through the pipeline) while checking race condition (calldata posted)
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            h.byzantine.stubCalldataHandler(2);
            h.contextApi.storeSnapshotCount(2, "before_isolation");
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
            h.byzantine.restoreCalldataHandler(2);
        });
    });
});
