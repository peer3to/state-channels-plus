import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expect } from "chai";

// Trello card Case 1: stateProof = [M1, M2, M3] where M1 and M2 have different
// InboundMessageBlockHashes. Variations 1.1–1.5 below.
//
// Setup harness: scenario.junkDataMilestoneMultiLeaveSetup (Cases 1.1–1.4) and
// scenario.junkDataMilestoneM1InboundThenM2Setup (Case 1.5) produce ≥3 milestones
// covering the M1/M2/M3 shape. We tamper auditingData.milestoneSnapshots[1]
// (the M2 row) to inject each Case's specific corruption, then assert the
// fraud-proof pipeline kills the dispute with DisputeInvalidStateProof.

describe("E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence)", function () {
    describe("Case 1.1: auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = random", function () {
        it("→ DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(0, (d, _dc, ad) => {
                if (!ad) {
                    throw new Error("expected calldata auditing data");
                }
                expect(
                    d.input.stateProof.milestones.length,
                    "need ≥2 milestones to target M2 snapshot"
                ).to.be.greaterThanOrEqual(2);
                expect(d.postedAuditingData).to.equal(true);
                ad.milestoneSnapshots[1]!.snapshotData.latestInboundMessageBlockHash =
                    randomHash();
                d.input.disputeAuditingDataHash = hash(
                    Codec.encode(ad, Type.DisputeAuditingData)
                );
            });

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });
    });

    describe("Case 1.2: auditingData.milestoneSnapshots[1] = honestly-produced M2 snapshot (control)", function () {
        // SKIPPED — needs clarification from reviewer.
        //
        // The Trello card text reads: "M2 inbound hash is valid, but stateSnapshot
        // updated to M2". Two interpretations:
        //
        //  (a) Honest control — the M2 auditing row honestly reflects M2's actual
        //      post-message state, including the new inbound message included at
        //      M2. The dispute should commit and NOT be killed; the pipeline must
        //      accept honest rows. This mirrors a "no fraud detected" pass on the
        //      same setup that Cases 1.1, 1.3, 1.4, 1.5 break.
        //
        //  (b) A subtly invalid case where "snapshot updated to M2" denotes some
        //      specific corrupted M2 representation distinct from the skip-ahead /
        //      stay-back / participant-set variants. The card doesn't elaborate.
        //
        // Interpretation (a) is the natural reading given the card's symmetry
        // (1.1 corrupts inbound hash, 1.3 = skip-ahead, 1.4 = stay-back, 1.5 =
        // participants). However writing the honest control as `postTamperedDispute(0, () => {})`
        // is awkward in this setup — peer 0 has no naturally-arising "reason" to
        // dispute (no fraud, no timeout). Asserting "no DisputeInvalidStateProof
        // event observed" without a real dispute trigger is a weak test.
        //
        // To resurrect this test, either:
        //   - Replace the setup with one where peer 0 has a real dispute reason
        //     (e.g. self-removal) and assert the dispute commits cleanly without
        //     any DisputeInvalidStateProof fraud proof being stored, OR
        //   - Confirm with reviewer that interpretation (b) is intended and
        //     design the specific corruption.
        it.skip("→ dispute commits without DisputeInvalidStateProof (honest control)", function () {});
    });

    describe("Case 1.3: auditingData.milestoneSnapshots[1] = milestoneSnapshots[2] (M2 row claims M3 snapshot, skip-ahead)", function () {
        it("→ DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(
                0,
                (dispute, _dc, auditingData) => {
                    if (!auditingData) {
                        throw new Error("expected calldata auditing data");
                    }
                    expect(
                        auditingData.milestoneSnapshots.length,
                        "auditing must expose a snapshot per milestone proof"
                    ).to.be.greaterThanOrEqual(3);
                    // M2 row carries M3's full snapshot (hash won't match M2 proof's finalizedSnapshotHash).
                    auditingData.milestoneSnapshots[1] =
                        auditingData.milestoneSnapshots[2]!;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });
    });

    describe("Case 1.4: auditingData.milestoneSnapshots[1] = milestoneSnapshots[0] (M2 row claims M1 snapshot, stay-back)", function () {
        it("→ DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(
                0,
                (dispute, _dc, auditingData) => {
                    if (!auditingData) {
                        throw new Error("expected calldata auditing data");
                    }
                    expect(
                        auditingData.milestoneSnapshots.length,
                        "auditing must expose a snapshot per milestone proof"
                    ).to.be.greaterThanOrEqual(3);
                    // M2 row carries M1's full snapshot (hash won't match M2 proof's finalizedSnapshotHash).
                    auditingData.milestoneSnapshots[1] =
                        auditingData.milestoneSnapshots[0]!;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });
    });

    describe("Case 1.5: auditingData.milestoneSnapshots[1].snapshotData.participants omits pending joiner (M1 colluding on M2)", function () {
        it("→ DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            const { pendingJoin } =
                await h.scenario.junkDataMilestoneM1InboundThenM2Setup();

            await h.tamper.postTamperedDispute(0, (d, _dc, ad) => {
                if (!ad) {
                    throw new Error("expected calldata auditing data");
                }
                expect(
                    d.input.stateProof.milestones.length,
                    "need ≥2 milestones to target M2 snapshot"
                ).to.be.greaterThanOrEqual(2);
                expect(d.postedAuditingData).to.equal(true);
                expect(
                    ad.milestoneSnapshots.length,
                    "auditing must align with milestone proofs"
                ).to.be.greaterThanOrEqual(2);
                const row = ad.milestoneSnapshots[1]!;
                row.snapshotData.participants =
                    row.snapshotData.participants.filter(
                        (p) => !addressesEqual(p, pendingJoin)
                    );
                d.input.disputeAuditingDataHash = hash(
                    Codec.encode(ad, Type.DisputeAuditingData)
                );
            });

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });
    });
});
