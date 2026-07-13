import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / balanceInvariant", function () {
    it("validator's locally-stored snapshot corrupted (sum of balances ≠ totalBalance) → DisputeInvalidBalanceInvariant", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();

        // Corrupt snapshot store
        await h.tamper.corruptValidatorSnapshotForBalanceInvariant(2);

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [2],
            initiatedWithAuditingData: false
        });

        await h.event.waitForAllPeers("onDisputeKilled", 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait();
    });
});
