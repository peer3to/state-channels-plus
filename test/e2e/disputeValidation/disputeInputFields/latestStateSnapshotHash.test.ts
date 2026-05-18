import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    DisputeTampering,
    expectMilestonesOnlyStateProof,
    MathTestSession as TestSession
} from "@test/harness";

// dispute.input.latestStateSnapshotHash must commit to the head of the verified
// state proof. Tampering only the hash (leaving the proof intact) is caught by
// `DisputeInvalidStateProof` regardless of which carrier the proof uses. The
// signedBlocks variants live in stateProof/case3_signedBlocksOnly.test.ts and
// the empty-proof variants live in stateProof/case2_empty.test.ts; this file
// covers the milestones carrier.

describe("E2E: dispute validation / disputeInputFields / latestStateSnapshotHash", function () {
    describe("no calldata, milestones-only stateProof", function () {
        it("dispute.input.latestStateSnapshotHash tampered → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            // Stub peer 1's dispute construction to corrupt latestStateSnapshotHash.
            // postedAuditingData remains false → no-calldata path.
            h.tamper.stubConstructDispute(1, (d) => {
                expectMilestonesOnlyStateProof(d.input.stateProof);
                DisputeTampering.tamperInvalidStateProof(d);
            });

            await h.byzantine.submitInvalidStateTransitionBlock(2);

            await h.assert.dispute.initiatedWait({
                peersIndices: [1],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    // The calldata variant of "milestones-only stateProof, hash tampered" lives
    // in stateProof/case5_other.test.ts under "milestones, full auditors, wrong
    // latestStateSnapshotHash (calldata)" — placing it there keeps the calldata-
    // vs-no-calldata variation visible alongside the other Case 5 break-its.
});
