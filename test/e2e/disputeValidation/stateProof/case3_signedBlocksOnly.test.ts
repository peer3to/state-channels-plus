import { DisputeFraudProofType } from "@/types/sol-enums";
import { Hash } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";

// Trello card Case 3: signedBlocks-only stateProof. Must build on genesis and
// blocks must be linked to each other. Subcases break the linkage or block content
// in various ways and assert the fraud-proof pipeline kills the dispute.

// latestStateSnapshotHash tamper variants (Case 3 carrier) live in
// disputeInputFields/latestStateSnapshotHash.test.ts.

describe("E2E: dispute validation / stateProof / Case 3 (signedBlocks-only)", function () {
    describe("stateProof.signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash (stateSnapshotHash mismatch)", function () {
        it("stateSnapshotHash = ZeroHash → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                if (
                    stateProof.milestones.length > 0 ||
                    stateProof.signedBlocks.length === 0
                ) {
                    throw new Error(
                        `Expected 0 milestones + signedBlocks, got milestones=${stateProof.milestones.length} signedBlocks=${stateProof.signedBlocks.length}`
                    );
                }
                await svc.rewriteLastSignedBlockInDispute(dispute, (bs) => ({
                    ...bs,
                    stateSnapshotHash: svc.zeroHash
                }));
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("stateProof.signedBlocks[-1].encodedBlock.messageBlocks injected with forged inbound message", function () {
        it("messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(
                3,
                async (dispute, sm, args) => {
                    const svc = sm.p2pManager.localRpc.dispute;
                    const stateProof = dispute.input.stateProof;
                    if (
                        stateProof.milestones.length > 0 ||
                        stateProof.signedBlocks.length === 0
                    ) {
                        throw new Error(
                            `Expected 0 milestones + signedBlocks, got milestones=${stateProof.milestones.length} signedBlocks=${stateProof.signedBlocks.length}`
                        );
                    }
                    await svc.rewriteLastSignedBlockInDispute(
                        dispute,
                        (bs) => ({
                            ...bs,
                            messageBlocks: [
                                {
                                    previousBlockHash: svc.zeroHash,
                                    blockHeight: 1n,
                                    messages: [
                                        {
                                            messageType: svc.randomHash(),
                                            participant:
                                                args.messageParticipant as string,
                                            balance: { amount: 1n, data: "0x" },
                                            data: svc.randomHash()
                                        }
                                    ],
                                    totalBalance: { amount: 1n, data: "0x" },
                                    timestamp: BigInt(svc.nowSeconds())
                                }
                            ]
                        })
                    );
                },
                { args: { messageParticipant: h.getPeer(1).address } }
            );

            // peer 1 double signs
            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1);
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("stateProof.signedBlocks[1].previousBlockHash = random (inter-block linkage break)", function () {
        // _areSignedBlocksLinkedAndVerified (StateProofFacet.sol:104) returns false at iter 1
        // when signedBlocks[1].previousBlockHash != keccak256(signedBlocks[0].encodedBlock).
        // The off-chain pipeline detects this and creates a fraud proof, but the on-chain
        // applyFraudProof handler currently rejects with ErrorInvalidFraudProof — the
        // off-chain pipeline and on-chain handler disagree on the apply step for linkage
        // failures. Keeping the test in place so the failure surfaces continuously.
        it("signedBlocks[1].previousBlockHash = random → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                if (stateProof.milestones.length !== 0) {
                    throw new Error(
                        "expected 0 milestones for signedBlocks-only path"
                    );
                }
                if (stateProof.signedBlocks.length < 2) {
                    throw new Error(
                        "need ≥2 signedBlocks to break inter-block linkage"
                    );
                }
                await d.rewriteSignedBlockAtIndex(dispute, 1, (bs) => ({
                    ...bs,
                    previousBlockHash: d.randomHash() as Hash
                }));
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
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
});
