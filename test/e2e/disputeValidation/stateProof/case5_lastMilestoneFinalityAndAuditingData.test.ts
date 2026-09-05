import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / last-milestone finality and auditing data", function () {
    describe("dispute.postedAuditingData = false AND stateProof.milestones[-1] is not final", function () {
        it("→ DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;

            await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });

            //  peer 0 turn
            await h.transition.advanceState({ waitForPeers: [0, 1] });

            h.event.resetEventSpies();

            await h.tamper.stubConstructDispute(2, (dispute) => {
                dispute.postedAuditingData = false;
            });

            // This case audits peer 2's missing-data claim. A second valid dispute
            // would make every auditor replay that proof first inside the same window.
            await h
                .control(h.getPeer(0))
                .stub.stubSuppressDisputeInitiation()
                .request();

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
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            });
            // Once the bad claim is killed, submit the honest evidence through the
            // normal owner so a surviving dispute can drive the reduction.
            await h.rpcStub.restoreDisputeInitiationAndDispute(0, forkId);
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });
});
