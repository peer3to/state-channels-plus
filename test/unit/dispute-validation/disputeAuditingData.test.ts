import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

// Auditing-data reconstruction kills: the calldata content must reconcile
// with the committed hash and the state proof. See also
// stateProof/case1_inboundDivergence.test.ts for the per-milestone-snapshot
// content tampers of the same matrix.

describe("dispute-validation / disputeAuditingData", function () {
    it(
        "should reject dispute when auditing data is partial and state proof invalid",
        covers(
            {
                milestoneSnapshots: "empty",
                proofType: "DisputeInvalidStateProof",
                postedAuditingData: "true",
                carrier: "milestones"
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
        )
    );

    it(
        "should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid",
        covers(
            {
                stateProof: "valid",
                disputeAuditingDataHash: "linked",
                proofType: "DisputeInvalidStateProof"
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
        )
    );
});
