import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { scenario } from "@test/harness/scenario";

// Randomly inject blocks with incorrect channelId and/or forkId
// into the stateProof.

describe("E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId", function () {
    describe("signedBlocks", function () {
        scenario(
            "stateProof.signedBlocks[-1].header.channelId = random → DisputeStateProofHeaderMismatch",
            {
                target: [
                    "DisputeInput.stateProof:header-mismatch",
                    "TransactionHeader.channelId:injected"
                ],
                setup: "proof:signedblocks"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupDisconnectedPeer();

                h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    d.expectSignedBlocksOnlyStateProof(
                        dispute.input.stateProof
                    );
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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            }
        );

        scenario(
            "stateProof.signedBlocks[-1].header.forkId = random → DisputeStateProofHeaderMismatch",
            {
                target: [
                    "DisputeInput.stateProof:header-mismatch",
                    "TransactionHeader.forkId:injected"
                ],
                outcome: "InvalidProof",
                setup: "proof:signedblocks"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupDisconnectedPeer();

                h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    d.expectSignedBlocksOnlyStateProof(
                        dispute.input.stateProof
                    );
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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            }
        );
    });

    describe("milestone blockConfirmations", function () {
        scenario(
            "stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch",
            {
                target: [
                    "DisputeInput.stateProof:header-mismatch",
                    "TransactionHeader.channelId:injected"
                ],
                setup: "proof:milestones"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();

                h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait({
                    syntheticOnChainParticipants: 1
                });
            }
        );

        scenario(
            "stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch",
            {
                target: [
                    "DisputeInput.stateProof:header-mismatch",
                    "TransactionHeader.forkId:injected"
                ],
                setup: "proof:milestones"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();

                h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait({
                    syntheticOnChainParticipants: 1
                });
            }
        );
    });

    scenario.skip(
        "transactionCnt duplicate / out-of-order -> N/A (covered on other axes)",
        {
            target: [
                "TransactionHeader.transactionCnt:duplicate",
                "TransactionHeader.transactionCnt:out-of-order"
            ],
            unreachable:
                "duplicate cnt = double sign (Block.transaction:double-signed); out-of-order cnt = not next author (timeout). not independently reachable as a header tamper"
        }
    );

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
            scenario(
                "signedBlocks: uniform junk forkId → committed, no kill, honest peers stay on current fork",
                {
                    invariant: "no-honest-loss",
                    target: "DisputeInput.forkId:uniform-junk",
                    setup: "proof:signedblocks"
                },
                async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupDisconnectedPeer();
                    const originalForkId = h.context.originalForkId!;

                    h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                        expectedCount: 1,
                        timeoutMs: 10000
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
                        expect(
                            forkId,
                            `peer ${p.index} forkId changed`
                        ).to.equal(originalForkId);
                    }
                }
            );

            scenario(
                "milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork",
                {
                    invariant: "no-honest-loss",
                    target: "DisputeInput.forkId:uniform-junk",
                    setup: "proof:milestones"
                },
                async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupCalldataPath();
                    const originalForkId = h.context.originalForkId!;

                    h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                        expectedCount: 1,
                        timeoutMs: 10000
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
                        expect(
                            forkId,
                            `peer ${p.index} forkId changed`
                        ).to.equal(originalForkId);
                    }
                }
            );
        });
    });
});
