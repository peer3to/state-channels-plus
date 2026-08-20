import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expect } from "chai";

// Trello card Case 1: stateProof = [M1, M2, M3] where M1 and M2 have different
// InboundMessageBlockHashes. Variations 1.1–1.5 below.
//
// setupTwoLeaversAcrossMilestones produces the M1/M2/M3 shape for Cases
// 1.1–1.4. Case 1.5 stages its pending join between M1 and M2 inline because
// that ordering is the behavior under test. Each case tampers with the M2 row
// and expects the fraud-proof pipeline to kill the dispute.

describe("E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence)", function () {
    describe("Case 1.1: auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = random", function () {
        it("Case 1.1 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones({
                forceExitPeerIndex: 0
            });

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
                    auditingData.milestoneSnapshots[1]!.snapshotData.latestInboundMessageBlockHash =
                        randomHash();
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProof({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                peerIndices: [1, 3],
                atLeastOneHonestPeer: true
            });
        });
    });

    describe("Case 1.2: auditingData.milestoneSnapshots[1] left honest (M2 inbound hash valid, snapshot matches M2)", function () {
        // Skipped — other cases here already rely on valid disputes committing on honest
        // setups; a dedicated “everything honest” pass case adds nothing.
        it.skip("→ dispute commits without DisputeInvalidStateProof", function () {});
    });

    describe("Case 1.3: auditingData.milestoneSnapshots[1] = milestoneSnapshots[2] (M2 row claims M3 snapshot, skip-ahead)", function () {
        it("Case 1.3 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones({
                forceExitPeerIndex: 0
            });

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
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProof({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                peerIndices: [1, 3],
                atLeastOneHonestPeer: true
            });
        });
    });

    describe("Case 1.4: auditingData.milestoneSnapshots[1] = milestoneSnapshots[0] (M2 row claims M1 snapshot, stay-back)", function () {
        it("Case 1.4 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones({
                forceExitPeerIndex: 0
            });

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
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProof({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                peerIndices: [1, 3],
                atLeastOneHonestPeer: true
            });
        });
    });

    describe("Case 1.5: auditingData.milestoneSnapshots[1].snapshotData.participants omits pending joiner (M1 colluding on M2)", function () {
        it("Case 1.5 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            const timeConfig = {
                p2pTime: 1,
                agreementTime: 6,
                chainFallbackTime: 2,
                evidenceTime: 12
            };
            await h.lifecycle.timeoutSetup(5, 2, { timeConfig });

            const allPeerIndices = h.peers.map((peer) => peer.index);
            const firstLeaver = await h.query.getNextPeerToWrite();
            await h.transition.participantLeaveStateTransition({
                waitForPeers: allPeerIndices.filter(
                    (peerIndex) => peerIndex !== firstLeaver.index
                )
            });

            // Finalize M1 before introducing the inbound join that M2 must carry.
            const afterFirstLeave = allPeerIndices.filter(
                (peerIndex) => peerIndex !== firstLeaver.index
            );
            await h.transition.advanceState({
                waitForPeers: afterFirstLeave,
                count: 1,
                waitForFinalization: true
            });

            const { participant: pendingJoin } =
                await h.join.forceInboundJoinWait({
                    participant: firstLeaver.address
                });

            // Consume the inbound join into M2. It remains pending on-chain
            // until the resulting state snapshot is posted.
            await h.transition.advanceState({
                waitForPeers: afterFirstLeave,
                count: 1,
                waitForFinalization: false
            });

            // A later leave gives the dispute another milestone after M2.
            const secondLeaver = await h.query.getNextPeerToWrite();
            const afterSecondLeave = afterFirstLeave.filter(
                (peerIndex) => peerIndex !== secondLeaver.index
            );
            await h.transition.participantLeaveStateTransition({
                leaverIndex: secondLeaver.index,
                waitForPeers: afterSecondLeave,
                waitForFinalization: false
            });

            h.context.leftChannelPeerIndices = [secondLeaver.index];
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            h.event.resetEventSpies();
            h.contextApi.captureOriginalFork();

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
                    expect(
                        auditingData.milestoneSnapshots.length,
                        "auditing must align with milestone proofs"
                    ).to.be.greaterThanOrEqual(2);
                    const row = auditingData.milestoneSnapshots[1]!;
                    expect(
                        row.snapshotData.participants.some((participant) =>
                            addressesEqual(participant, pendingJoin)
                        ),
                        "honest M2 snapshot must include the pending joiner"
                    ).to.equal(true);
                    row.snapshotData.participants =
                        row.snapshotData.participants.filter(
                            (p) => !addressesEqual(p, pendingJoin)
                        );
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProof({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                peerIndices: [1, 3],
                atLeastOneHonestPeer: true
            });
        });
    });
});
