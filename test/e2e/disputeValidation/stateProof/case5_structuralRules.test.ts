import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / structural rules", function () {
    describe("each milestone must have at least one blockConfirmation", function () {
        it("stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            // An empty milestone makes the walk invalid.
            await h.tamper.stubConstructDispute(
                3,
                (d) => {
                    if (d.input.stateProof.milestones.length === 0) {
                        throw new Error(
                            "Expected milestones in calldata-path state proof"
                        );
                    }
                    d.input.stateProof.milestones[0].blockConfirmations = [];
                },
                { autoRestore: true }
            );

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
        });
    });
});
