import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Randomly inject blocks with incorrect channelId and/or forkId
// into the stateProof.

describe("E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId", function () {
    describe("signedBlocks", function () {
        it("stateProof.signedBlocks[-1].header.channelId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                d.expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await d.rewriteLastSignedBlockInDispute(dispute, (bs) =>
                    d.blockStructWithTransactionHeader(bs, {
                        channelId: d.randomHash()
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
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("stateProof.signedBlocks[-1].header.forkId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                d.expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await d.rewriteLastSignedBlockInDispute(dispute, (bs) =>
                    d.blockStructWithTransactionHeader(bs, {
                        forkId: d.randomHash()
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
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("stateProof.signedBlocks[0].header.forkId = random → DisputeStateProofHeaderMismatch", async function () {
            // The FIRST signed block (height 0) on a wrong fork must be caught by
            // the Solidity header-mismatch check and kill the dispute BEFORE the
            // pipeline runs - so the dispute-strategy wrong-genesis path is only
            // ever reached for a block[0] that is genuinely on the disputed fork.
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                d.expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await d.rewriteSignedBlockAtIndex(dispute, 0, (bs) =>
                    d.blockStructWithTransactionHeader(bs, {
                        forkId: d.randomHash()
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
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("milestone blockConfirmations", function () {
        it("stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                await d.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) =>
                        d.blockStructWithTransactionHeader(bs, {
                            channelId: d.randomHash()
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
                forkId,
                syntheticOnChainParticipants: 1
            });
        });

        it("stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                await d.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) =>
                        d.blockStructWithTransactionHeader(bs, {
                            forkId: d.randomHash()
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
                forkId,
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

                await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    d.expectSignedBlocksOnlyStateProof(
                        dispute.input.stateProof
                    );
                    await d.rewriteUniformForkIdInDispute(
                        dispute,
                        d.randomHash()
                    );
                });

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: false
                });

                await h.assert.dispute.committedWait({
                    peersIndices: h.getHonestPeers().map((p) => p.index),
                    expectedCount: 1
                });

                await h.event.waitWhileEventCountsStayAtMost(
                    "onDisputeKilled",
                    h.getHonestPeers().map((p) => p.index),
                    { durationMs: 6000, maxCount: 0 }
                );

                for (const p of h.getHonestPeers()) {
                    const forkId = await h
                        .control(p)
                        .query.getForkId()
                        .request();
                    expect(forkId, `peer ${p.index} forkId changed`).to.equal(
                        originalForkId
                    );
                }
            });

            it("milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();
                const originalForkId = h.context.originalForkId!;

                await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    await d.rewriteUniformForkIdInDispute(
                        dispute,
                        d.randomHash()
                    );
                });

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: true
                });

                await h.assert.dispute.committedWait({
                    peersIndices: h.getHonestPeers().map((p) => p.index),
                    expectedCount: 1
                });

                await h.event.waitWhileEventCountsStayAtMost(
                    "onDisputeKilled",
                    h.getHonestPeers().map((p) => p.index),
                    { durationMs: 6000, maxCount: 0 }
                );

                for (const p of h.getHonestPeers()) {
                    const forkId = await h
                        .control(p)
                        .query.getForkId()
                        .request();
                    expect(forkId, `peer ${p.index} forkId changed`).to.equal(
                        originalForkId
                    );
                }
            });
        });
    });
});
