import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { scenario } from "@test/harness/scenario";
import { expect } from "chai";

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
        scenario(
            "should reduce invalid state transition disputes and create new fork",
            { invariant: "no-honest-loss" },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({ peerCount: 4 });
                const nextPeer = await h.query.getNextPeerToWrite();
                await h.byzantine.submitInvalidStateTransitionBlock(
                    nextPeer.index
                );
                await h.assert.dispute.initiatedAndCommitedWait();
                await h.dispute.resolveDisputeWait();
            }
        );

        it("should post updated state snapshot after fork resolution", async function () {
            const h = TestSession.getHarness();
            await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateWait();

            await h.assert.sync.onlyHonestPeersInSync();
            await h.transition.fromHonestPeersOnly((c) => c.add(1));
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

    describe("Evidence window — multi-dispute", function () {
        // what: two DISTINCT participants each file a valid self-removal on the SAME open window
        //       within the evidence period -> both accumulate, then ONE reduction removes both.

        scenario(
            "two distinct self-removals accumulate in one window and reduce together → both removed",
            { invariant: "no-honest-loss" },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    peerCount: 4,
                    timeConfig: { agreementTime: 8, evidenceTime: 8 }
                });

                const leaverA = 1;
                const leaverB = 2;
                const leaverAddrA = h.getPeer(leaverA).address;
                const leaverAddrB = h.getPeer(leaverB).address;

                // both are voluntary leavers: skip sync barriers, don't mark malicious.
                h.context.leftChannelPeerIndices = [
                    ...h.context.leftChannelPeerIndices,
                    leaverA,
                    leaverB
                ];

                // disputer A opens the window with a valid self-removal.
                await h
                    .control(h.getPeer(leaverA))
                    .dispute.setForceExit(true)
                    .request();
                await h.tamper.postTamperedDispute(leaverA, () => {}, {
                    markMalicious: false
                });

                // disputer B (distinct -> not throttled) joins the SAME window in-period: 2nd commitment.
                await h
                    .control(h.getPeer(leaverB))
                    .dispute.setForceExit(true)
                    .request();
                await h.tamper.postTamperedDispute(leaverB, () => {}, {
                    markMalicious: false
                });

                const remainingPeers = h
                    .getPeersExcludingMaliciousAndLeavers()
                    .map((p) => p.index);

                await h.assert.dispute.committedWait({
                    peersIndices: remainingPeers,
                    expectedCount: 2
                });

                await h.dispute.resolveDisputeWait({
                    honestPeerIndices: remainingPeers
                });

                expect(
                    h.event.getEventCallCount(
                        remainingPeers[0],
                        "onDisputeReducedResultCommitted"
                    ),
                    "both disputes should resolve in a single reduction"
                ).to.equal(1);

                await h.assert.sync.participantCount({ expectedCount: 2 });
                const participants = await h
                    .control(h.getPeer(0))
                    .query.getParticipants()
                    .request();
                expect(
                    participants.some((p) => addressesEqual(p, leaverAddrA)),
                    "leaver A should be removed by the combined reduction"
                ).to.equal(false);
                expect(
                    participants.some((p) => addressesEqual(p, leaverAddrB)),
                    "leaver B should be removed by the combined reduction"
                ).to.equal(false);
            }
        );
    });

    describe("Fraud Proof Detection", function () {
        scenario(
            "should kill a spam dispute with no legitimate enforcement basis",
            {
                invariant: "attacker-pays",
                target: [
                    "DisputeInput.timeout:absent",
                    "DisputeInput.onChainSlashes:empty",
                    "DisputeInput.selfRemoval:false"
                ],
                setup: ["calldata:absent", "proof:milestones"]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    timeConfig: { evidenceTime: 6 }
                });

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

                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.InvalidDisputeReason
                    }
                );

                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 15000
                });
            }
        );

        scenario(
            "should reject dispute when auditing data is partial and state proof invalid",
            {
                invariant: "attacker-pays",
                target: [
                    "DisputeAuditingData.milestoneSnapshots:empty",
                    "DisputeInput.stateProof:valid"
                ]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();

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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof,
                        timeoutMs: 15000
                    }
                );
                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 15000,
                    syntheticOnChainParticipants: 1
                });
            }
        );

        scenario(
            "should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid",
            {
                invariant: "attacker-pays",
                target: [
                    "DisputeInput.stateProof:valid",
                    "DisputeInput.disputeAuditingDataHash:linked"
                ]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    timeConfig: { evidenceTime: 6 }
                });
                await h.byzantine.tamperedDisputeDoubleFault(1);
                await h.event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof
                    }
                );
                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 20000
                });
            }
        );
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
