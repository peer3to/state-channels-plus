import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / last-milestone finality and auditing data", function () {
    describe("dispute.postedAuditingData = false AND stateProof.milestones[-1] is not final", function () {
        it("→ DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.transition.advanceState({
                txFn: { op: "math.leaveChannel" }
            });

            //  peer 0 turn
            await h.transition.advanceState({ waitForPeers: [0, 1] });

            h.event.resetEventSpies();

            await h.tamper.stubConstructDispute(2, (dispute) => {
                dispute.postedAuditingData = false;
            });

            // Peer 1 submits a faulty block
            await h.byzantine.submitInvalidStateTransitionBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [2],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
