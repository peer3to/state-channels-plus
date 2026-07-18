import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / structural rules", function () {
    describe("stateProof.milestones and stateProof.signedBlocks are mutually exclusive", function () {
        it("stateProof.milestones.length > 0 AND stateProof.signedBlocks.length > 0 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            // preDisputeSetupCalldataPath produces a milestones-only state proof.
            await h.scenario.preDisputeSetupCalldataPath();

            // Inject an extra signedBlock alongside the real milestones.
            // verifyStateProof rejects any proof where both arrays are non-empty.
            // Copy a real milestone block so headers match dispute.input (factory.signedBlock
            // uses a dummy channelId which would trigger DisputeStateProofHeaderMismatch).
            await h.tamper.stubConstructDispute(
                3,
                (d) => {
                    if (d.input.stateProof.milestones.length === 0) {
                        throw new Error(
                            "Expected milestones in calldata-path state proof"
                        );
                    }
                    const src =
                        d.input.stateProof.milestones[0].blockConfirmations[0]
                            .signedBlock;
                    d.input.stateProof.signedBlocks = [
                        {
                            encodedBlock: src.encodedBlock,
                            signature: src.signature
                        }
                    ];
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
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("each milestone must have at least one blockConfirmation", function () {
        it("stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            // Empty blockConfirmations on the first milestone causes
            // _isMilestoneFinalWithExpectedParticipants to return (false, 0)
            // immediately, making _tryVerifyMilestones return false.
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
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("unfinalized milestone block structure", function () {
        it("invalid tail signature → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.tamper.stubConstructDispute(3, (dispute) => {
                const confirmations =
                    dispute.input.stateProof.milestones.at(
                        -1
                    )?.blockConfirmations;
                if (!confirmations || confirmations.length === 0) {
                    throw new Error("Expected a milestone block");
                }
                const source = confirmations.at(-1)!;
                const wrongSignerSignature = source.signatures[0];
                if (!wrongSignerSignature) {
                    throw new Error(
                        "Expected a milestone confirmation signature"
                    );
                }
                confirmations.push({
                    signedBlock: {
                        encodedBlock: source.signedBlock.encodedBlock,
                        signature: wrongSignerSignature
                    },
                    signatures: []
                });
            });
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });
});
