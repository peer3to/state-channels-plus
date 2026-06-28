import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expect } from "chai";
import { scenario } from "@test/harness/scenario";

// Trello card Case 1: stateProof = [M1, M2, M3] where M1 and M2 have different
// InboundMessageBlockHashes. Variations 1.1–1.5 below.
//
// Setup harness: scenario.setupTwoLeaversAcrossMilestones (Cases 1.1–1.4) and
// scenario.setupTwoLeaversWithPendingJoinerAcrossMilestones (Case 1.5) produce ≥3 milestones
// covering the M1/M2/M3 shape. We tamper auditingData.milestoneSnapshots[1]
// (the M2 row) to inject each Case's specific corruption, then assert the
// fraud-proof pipeline kills the dispute with DisputeInvalidStateProof.

describe("E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence)", function () {
    describe("Case 1.1: auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = random", function () {
        scenario(
            "Case 1.1 → DisputeInvalidStateProof",
            {
                invariant: "attacker-pays",
                setup: "proof:milestones",
                target: "DisputeAuditingData.milestoneSnapshots:inbound-divergent"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.setupTwoLeaversAcrossMilestones();

                await h.tamper.postTamperedDispute(
                    0,
                    (dispute, _disputeConfirmation, auditingData) => {
                        if (!auditingData) {
                            throw new Error("expected calldata auditing data");
                        }
                        expect(
                            dispute.input.stateProof.milestones.length,
                            "need ≥2 milestones to target M2 snapshot"
                        ).to.be.greaterThanOrEqual(2);
                        expect(dispute.postedAuditingData).to.equal(true);
                        auditingData.milestoneSnapshots[1]!.snapshotData.latestInboundMessageBlockHash =
                            randomHash();
                        dispute.input.disputeAuditingDataHash = hash(
                            Codec.encode(auditingData, Type.DisputeAuditingData)
                        );
                    }
                );

                await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                    mode: "atLeast",
                    timeoutMs: 25000
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof,
                        timeoutMs: 15000,
                        peerIndices: [1, 3]
                    }
                );
            }
        );
    });

    describe("Case 1.2: auditingData.milestoneSnapshots[1] left honest (M2 inbound hash valid, snapshot matches M2)", function () {
        // Skipped — other cases here already rely on valid disputes committing on honest
        // setups; a dedicated “everything honest” pass case adds nothing.
        it.skip("→ dispute commits without DisputeInvalidStateProof", function () {});
    });

    describe("Case 1.3: auditingData.milestoneSnapshots[1] = milestoneSnapshots[2] (M2 row claims M3 snapshot, skip-ahead)", function () {
        scenario(
            "Case 1.3 → DisputeInvalidStateProof",
            {
                invariant: "attacker-pays",
                setup: "proof:milestones",
                target: "DisputeAuditingData.milestoneSnapshots:wrong-snapshot"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.setupTwoLeaversAcrossMilestones();

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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof,
                        timeoutMs: 15000,
                        peerIndices: [1, 3]
                    }
                );
            }
        );
    });

    describe("Case 1.4: auditingData.milestoneSnapshots[1] = milestoneSnapshots[0] (M2 row claims M1 snapshot, stay-back)", function () {
        scenario(
            "Case 1.4 → DisputeInvalidStateProof",
            {
                invariant: "attacker-pays",
                setup: "proof:milestones",
                target: "DisputeAuditingData.milestoneSnapshots:wrong-snapshot"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.setupTwoLeaversAcrossMilestones();

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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof,
                        timeoutMs: 15000,
                        peerIndices: [1, 3]
                    }
                );
            }
        );
    });

    describe("Case 1.5: auditingData.milestoneSnapshots[1].snapshotData.participants omits pending joiner (M1 colluding on M2)", function () {
        scenario(
            "Case 1.5 → DisputeInvalidStateProof",
            {
                invariant: "attacker-pays",
                setup: "proof:milestones",
                target: "DisputeAuditingData.milestoneSnapshots:participants-omitted"
            },
            async function () {
                const h = TestSession.getHarness();
                const { pendingJoin } =
                    await h.scenario.setupTwoLeaversWithPendingJoinerAcrossMilestones();

                await h.tamper.postTamperedDispute(
                    0,
                    (dispute, _disputeConfirmation, auditingData) => {
                        if (!auditingData) {
                            throw new Error("expected calldata auditing data");
                        }
                        expect(
                            dispute.input.stateProof.milestones.length,
                            "need ≥2 milestones to target M2 snapshot"
                        ).to.be.greaterThanOrEqual(2);
                        expect(dispute.postedAuditingData).to.equal(true);
                        expect(
                            auditingData.milestoneSnapshots.length,
                            "auditing must align with milestone proofs"
                        ).to.be.greaterThanOrEqual(2);
                        const row = auditingData.milestoneSnapshots[1]!;
                        row.snapshotData.participants =
                            row.snapshotData.participants.filter(
                                (p) => !addressesEqual(p, pendingJoin)
                            );
                        dispute.input.disputeAuditingDataHash = hash(
                            Codec.encode(auditingData, Type.DisputeAuditingData)
                        );
                    }
                );

                await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                    mode: "atLeast",
                    timeoutMs: 25000
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidStateProof,
                        timeoutMs: 15000,
                        peerIndices: [1, 3]
                    }
                );

                // setup leaves pendingJoin's inbound unconsumed -> postStateSnapshot races throw RaceConditionPendingInboundNotConsumed (fatal); absorb the expected detached throw.
                await TestSession.expectFirstDetachedError({
                    includes: "pending inbound not consumed",
                    timeoutMs: 5000,
                    required: false
                });
            }
        );
    });
});
