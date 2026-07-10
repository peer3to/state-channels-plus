import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

describe("dispute-validation / balanceInvariant", function () {
    it(
        "validator's locally-stored snapshot corrupted (sum of balances ≠ totalBalance) → DisputeInvalidBalanceInvariant",
        covers(
            {
                proofType: "DisputeInvalidBalanceInvariant",
                carrier: "milestones",
                postedAuditingData: "false"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();

                // pin the claimed carrier shape on the real constructed dispute
                h.tamper.stubConstructDispute(2, async (dispute, sm) => {
                    sm.p2pManager.localRpc.dispute.expectMilestonesOnlyStateProof(
                        dispute.input.stateProof
                    );
                });

                // Corrupt snapshot store
                h.tamper.corruptValidatorSnapshotForBalanceInvariant(2);

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedAndCommitedWait({
                    peersIndices: [2],
                    initiatedWithAuditingData: false
                });

                await h.event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidBalanceInvariant,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            }
        )
    );
});
