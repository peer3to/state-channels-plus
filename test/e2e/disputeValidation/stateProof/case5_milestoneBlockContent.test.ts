import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { ethers } from "ethers";

describe("E2E: dispute validation / stateProof / milestone block content integrity", function () {
    describe("stateProof.milestones[-1].blockConfirmations[-1].transaction.body.data", function () {
        it("body.data -> invalid call → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 6 }
            });
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(0, async (dispute) => {
                const invalidData = ethers.hexlify(ethers.randomBytes(32));

                await h.tamper.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) => ({
                        ...bs,
                        transaction: {
                            ...bs.transaction,
                            body: {
                                ...bs.transaction.body,
                                encodedData: invalidData,
                                data: invalidData
                            }
                        }
                    })
                );
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            const storedFraudProofWait =
                h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                    peerIndices: [2],
                    disputeFraudProofType:
                        DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                    timeoutMs: 60000
                });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            const unknownSnapshotCleanup = TestSession.expectFirstDetachedError(
                {
                    includes: "unknown snapshot",
                    required: false
                }
            );
            await unknownSnapshotCleanup;
            await storedFraudProofWait;
        });
    });
});
