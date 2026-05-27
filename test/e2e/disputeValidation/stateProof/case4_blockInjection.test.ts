import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    MathTestSession as TestSession,
    expectSignedBlocksOnlyStateProof
} from "@test/harness";
import {
    hash as randomHash,
    blockStructWithTransactionHeader
} from "@test/factory";
import { expect } from "chai";

// Randomly inject blocks with incorrect channelId and/or forkId
// into the stateProof.

describe("E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId", function () {
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

    describe("dispute.input fields (channelId, forkId)", function () {
        it.skip("dispute.input.channelId = random → upload fails → ErrorCantParticipateInDispute", function () {
            // Covered in test/e2e/disputeValidation/uploadRevert/channelId.test.ts
            // (reverts at upload; does not reach stateProof header checks).
        });

        it.skip("dispute.input.forkId = random (stateProof still on real fork) → junk fork ignored", function () {
            // Covered in test/e2e/disputeValidation/disputeInputFields/forkId.test.ts
            // (input-only tamper; stateProof headers still on the real fork).
        });

        describe("uniform junk forkId (dispute.input + entire stateProof)", function () {
            it("signedBlocks: uniform junk forkId → committed, no kill, honest peers stay on current fork", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupDisconnectedPeer();
                const originalForkId = h.context.originalForkId!;
                const junkForkId = randomHash();

                h.tamper.stubConstructDispute(3, async (dispute) => {
                    expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                    await h.tamper.rewriteUniformForkIdInDispute(
                        dispute,
                        junkForkId
                    );
                });

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: false
                });

                await h.assert.dispute.committedWait({
                    peersIndices: h.getHonestPeers().map((p) => p.index),
                    expectedCount: 1,
                    timeoutMs: 10000
                });

                await h.event.waitWhileEventCountsStayAtMost(
                    "onDisputeKilled",
                    h.getHonestPeers().map((p) => p.index),
                    { durationMs: 6000, maxCount: 0 }
                );

                for (const p of h.getHonestPeers()) {
                    expect(
                        h.getPeerHandle(p.index).forkId,
                        `peer ${p.index} forkId changed`
                    ).to.equal(originalForkId);
                }
            });

            it("milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();
                const originalForkId = h.context.originalForkId!;
                const junkForkId = randomHash();

                h.tamper.stubConstructDispute(3, async (dispute) => {
                    await h.tamper.rewriteUniformForkIdInDispute(
                        dispute,
                        junkForkId
                    );
                });

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: true
                });

                await h.assert.dispute.committedWait({
                    peersIndices: h.getHonestPeers().map((p) => p.index),
                    expectedCount: 1,
                    timeoutMs: 10000
                });

                await h.event.waitWhileEventCountsStayAtMost(
                    "onDisputeKilled",
                    h.getHonestPeers().map((p) => p.index),
                    { durationMs: 6000, maxCount: 0 }
                );

                for (const p of h.getHonestPeers()) {
                    expect(
                        h.getPeerHandle(p.index).forkId,
                        `peer ${p.index} forkId changed`
                    ).to.equal(originalForkId);
                }
            });
        });
    });
});
