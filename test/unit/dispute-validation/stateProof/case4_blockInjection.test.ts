import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { covers } from "../domain";

// Randomly inject blocks with incorrect channelId and/or forkId
// into the stateProof.

describe("dispute-validation / stateProof / block injection with incorrect channelId/forkId", function () {
    describe("signedBlocks", function () {
        it(
            "stateProof.signedBlocks[-1].header.channelId = random → DisputeStateProofHeaderMismatch",
            covers(
                {
                    stateProof: "header-mismatch",
                    proofType: "DisputeStateProofHeaderMismatch",
                    carrier: "signedblocks",
                    postedAuditingData: "false"
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
            )
        );

        it(
            "stateProof.signedBlocks[-1].header.forkId = random → DisputeStateProofHeaderMismatch",
            covers(
                {
                    stateProof: "header-mismatch",
                    proofType: "DisputeStateProofHeaderMismatch",
                    carrier: "signedblocks",
                    postedAuditingData: "false"
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
            )
        );
    });

    describe("milestone blockConfirmations", function () {
        it(
            "stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch",
            covers(
                {
                    stateProof: "header-mismatch",
                    proofType: "DisputeStateProofHeaderMismatch",
                    postedAuditingData: "true"
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
            )
        );

        it(
            "stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch",
            covers(
                {
                    stateProof: "header-mismatch",
                    proofType: "DisputeStateProofHeaderMismatch",
                    postedAuditingData: "true"
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
            )
        );
    });

    // transactionCnt duplicate / out-of-order header tampers are N/A here:
    // duplicate cnt = double sign (Block.transaction:double-signed); out-of-order
    // cnt = not next author (timeout). Not independently reachable as a header
    // tamper - those cells belong to the block-confirmation/timeouts domains.

    describe("dispute.input fields (channelId, forkId)", function () {
        // dispute.input.channelId = random → upload fails → ErrorCantParticipateInDispute.
        // Covered in test/unit/dispute-upload/uploadRevert/channelId.test.ts
        // (reverts at upload; does not reach stateProof header checks) - see the
        // domain's disputeInput.channelId:wrong unreachable rule.

        // dispute.input.forkId = random (stateProof still on real fork) → junk fork
        // ignored. Covered in disputeInputFields/forkId.test.ts
        // (input-only tamper; stateProof headers still on the real fork).

        describe("uniform junk forkId (dispute.input + entire stateProof)", function () {
            it(
                "signedBlocks: uniform junk forkId → committed, no kill, honest peers stay on current fork",
                covers(
                    {
                        forkId: "uniform-junk",
                        postedAuditingData: "false"
                    },
                    async function () {
                        const h = TestSession.getHarness();
                        await h.scenario.preDisputeSetupDisconnectedPeer();
                        const originalForkId = h.context.originalForkId!;

                        h.tamper.stubConstructDispute(
                            3,
                            async (dispute, sm) => {
                                const d = sm.p2pManager.localRpc.dispute;
                                d.expectSignedBlocksOnlyStateProof(
                                    dispute.input.stateProof
                                );
                                await d.rewriteUniformForkIdInDispute(
                                    dispute,
                                    d.randomHash()
                                );
                            }
                        );

                        await h.byzantine.submitDoubleSignBlock(1);

                        await h.assert.dispute.initiatedWait({
                            peersIndices: [3],
                            initiatedWithAuditingData: false
                        });

                        await h.assert.dispute.committedWait({
                            peersIndices: h
                                .getHonestPeers()
                                .map((p) => p.index),
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
                )
            );

            it(
                "milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork",
                covers(
                    {
                        forkId: "uniform-junk",
                        postedAuditingData: "true"
                    },
                    async function () {
                        const h = TestSession.getHarness();
                        await h.scenario.preDisputeSetupCalldataPath();
                        const originalForkId = h.context.originalForkId!;

                        h.tamper.stubConstructDispute(
                            3,
                            async (dispute, sm) => {
                                const d = sm.p2pManager.localRpc.dispute;
                                await d.rewriteUniformForkIdInDispute(
                                    dispute,
                                    d.randomHash()
                                );
                            }
                        );

                        await h.byzantine.submitDoubleSignBlock(1);

                        await h.assert.dispute.initiatedWait({
                            peersIndices: [3],
                            initiatedWithAuditingData: true
                        });

                        await h.assert.dispute.committedWait({
                            peersIndices: h
                                .getHonestPeers()
                                .map((p) => p.index),
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
                )
            );
        });
    });
});
