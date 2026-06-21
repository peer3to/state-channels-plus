import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

// The dispute's `outputSnapshotDataHash` commits to the post-reduction state
// snapshot. The validator recomputes this hash from the verified state proof +
// dispute input and rejects mismatches. See also disputeInputFields/selfRemoval.test.ts
// for the selfRemoval-flipped variant (which also fails via DisputeInvalidOutputState).

describe("E2E: dispute validation / outputState", function () {
    it("dispute.outputSnapshotDataHash = random → DisputeInvalidOutputState", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();

        h.tamper.stubConstructDispute(2, async (dispute, sm) => {
            dispute.outputSnapshotDataHash =
                sm.p2pManager.localRpc.dispute.hash("0x42");
        });

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [2],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidOutputState,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait();
    });
});
