import { DisputeFraudProofType } from "@/types/sol-enums";
import { ForkId, Hash } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / structural rules", function () {
    describe("each milestone must have at least one blockConfirmation", function () {
        it("stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            // The state-proof walk rejects a milestone with no
            // blockConfirmations.
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

    describe("unfinalized milestone block structure", function () {
        it("invalid tail signature → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
        });

        // preDisputeSetupDisconnectedPeer: peer 2 never signs, so the proof is
        // one unfinalized genesis block-0 milestone; every block is eligible.
        it("genesis block-0 milestone blockConfirmations[1].previousBlockHash = random → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                await d.expectUnfinalizedStateProof(
                    dispute.input.forkId as ForkId,
                    stateProof
                );
                const lastMilestoneIndex = stateProof.milestones.length - 1;
                if (
                    stateProof.milestones[lastMilestoneIndex].blockConfirmations
                        .length < 2
                ) {
                    throw new Error(
                        "need ≥2 milestone blocks to break inter-block linkage"
                    );
                }
                await d.rewriteMilestoneSignedBlockAtIndex(
                    dispute,
                    lastMilestoneIndex,
                    1,
                    (bs) => ({
                        ...bs,
                        previousBlockHash: d.randomHash() as Hash
                    })
                );
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("genesis block-0 milestone skipped height → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;
            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                await d.expectUnfinalizedStateProof(
                    dispute.input.forkId as ForkId,
                    stateProof
                );
                if (
                    (stateProof.milestones.at(-1)?.blockConfirmations.length ??
                        0) < 2
                )
                    throw new Error("Expected at least two milestone blocks");
                await d.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (block) =>
                        d.blockStructWithTransactionHeader(block, {
                            transactionCnt:
                                BigInt(
                                    block.transaction.header.transactionCnt
                                ) + 1n
                        })
                );
            });
            await h.byzantine.submitDoubleSignBlock(1);
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });
});
