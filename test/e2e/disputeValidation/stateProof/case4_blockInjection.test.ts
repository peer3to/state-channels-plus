import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    MathTestSession as TestSession,
    expectSignedBlocksOnlyStateProof
} from "@test/harness";
import {
    hash as randomHash,
    blockStructWithTransactionHeader
} from "@test/factory";

// Trello card Case 4: randomly inject blocks with different channelId and/or forkId
// into the stateProof. The contract validates header.channelId/forkId against
// dispute.input.channelId/forkId for every block in signedBlocks AND inside every
// milestone's blockConfirmations, and reverts (kills the dispute via
// DisputeStateProofHeaderMismatch) on any mismatch.
//
// Note: channelId and forkId mismatches were unified into a single fraud proof
// (`DisputeStateProofHeaderMismatch`) — see commit 66f20850. We still test both
// axes (channelId vs forkId) and both proof carriers (signedBlocks vs milestone
// blockConfirmations) because the contract iterates both fields independently.

describe("E2E: dispute validation / stateProof / Case 4 (block injection with wrong channelId/forkId)", function () {
    describe("signedBlocks", function () {
        it("stateProof.signedBlocks[-1].header.channelId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await h.tamper.rewriteLastSignedBlockInDispute(dispute, (bs) =>
                    blockStructWithTransactionHeader(bs, {
                        channelId: randomHash()
                    })
                );
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
                    DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });

        it("stateProof.signedBlocks[-1].header.forkId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await h.tamper.rewriteLastSignedBlockInDispute(dispute, (bs) =>
                    blockStructWithTransactionHeader(bs, {
                        forkId: randomHash()
                    })
                );
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
                    DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("milestone blockConfirmations", function () {
        it("stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                await h.tamper.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) =>
                        blockStructWithTransactionHeader(bs, {
                            channelId: randomHash()
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
                    DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });

        it("stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                await h.tamper.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) =>
                        blockStructWithTransactionHeader(bs, {
                            forkId: randomHash()
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
                    DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });
});
