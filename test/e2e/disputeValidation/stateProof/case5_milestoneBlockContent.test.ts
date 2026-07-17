import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / stateProof / milestone block content integrity", function () {
    describe("stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt", function () {
        it("transactionCnt += 5 → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 5,
                timeConfig: { evidenceTime: 3 }
            });
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ waitForPeers: [0, 1, 2, 4] });
            const disputedForkId = h.activeForkId;
            if (!disputedForkId) throw new Error("Expected an active fork");
            h.event.resetEventSpies();

            await h.tamper.stubConstructDispute(0, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                await svc.rewriteLastMilestoneBlockConfirmationInDispute(
                    dispute,
                    (block) => {
                        block.transaction.header.transactionCnt =
                            BigInt(block.transaction.header.transactionCnt) +
                            5n;
                        return block;
                    }
                );
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
            await h.tamper.restoreConstructDispute(0);

            await h.assert.dispute.committedWait({
                expectedCount: 2,
                mode: "atLeast",
                timeoutMs: 10000
            });
            expect(
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    disputedForkId
                )
            ).to.not.have.length(0);
            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });

            for (const peer of h.getHonestPeers()) {
                const finalCommit = peer.eventSpies.onDisputeCommitted
                    ?.getCalls()
                    .find((call) => call.args[3] === true);
                expect(
                    finalCommit,
                    `Peer ${peer.index} should not observe a final dispute`
                ).to.be.undefined;
            }

            await h.dispute.resolveDisputeWait({ forkId: disputedForkId });
        });
    });
});
