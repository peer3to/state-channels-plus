import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Hash } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Trello card Case 3: signedBlocks-only stateProof. Must build on genesis and
// blocks must be linked to each other. Subcases break the linkage or block content
// in various ways and assert the fraud-proof pipeline kills the dispute.

// latestStateSnapshotHash tamper variants (Case 3 carrier) live in
// disputeInputFields/latestStateSnapshotHash.test.ts.

describe("E2E: dispute validation / stateProof / Case 3 (signedBlocks-only)", function () {
    describe("stateProof.signedBlocks[0].previousBlockHash = random (wrong genesis anchor)", function () {
        it("height 0 first block with wrong genesis link → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                d.expectSignedBlocksOnlyStateProof(stateProof);

                await d.rewriteSignedBlockAtIndex(dispute, 0, (bs) => ({
                    ...bs,
                    previousBlockHash: d.randomHash() as Hash
                }));

                let previousBlockHash = d.hash(
                    stateProof.signedBlocks[0].encodedBlock
                ) as Hash;
                for (let i = 1; i < stateProof.signedBlocks.length; i++) {
                    await d.rewriteSignedBlockAtIndex(dispute, i, (bs) => ({
                        ...bs,
                        previousBlockHash
                    }));
                    previousBlockHash = d.hash(
                        stateProof.signedBlocks[i].encodedBlock
                    ) as Hash;
                }
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
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
        });
    });

    describe("stateProof.signedBlocks[0].transaction.header.transactionCnt != 0", function () {
        it("first signedBlock height is not 0 → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const stateProof = dispute.input.stateProof;
                d.expectSignedBlocksOnlyStateProof(stateProof);

                await d.rewriteSignedBlockAtIndex(dispute, 0, (bs) =>
                    d.blockStructWithTransactionHeader(bs, {
                        transactionCnt:
                            BigInt(bs.transaction.header.transactionCnt) + 1n
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof.signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash (stateSnapshotHash mismatch)", function () {
        it("stateSnapshotHash = ZeroHash → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof.signedBlocks[-1].encodedBlock.messageBlocks injected with forged inbound message", function () {
        it("messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(
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
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof.signedBlocks[1].previousBlockHash = random (inter-block linkage break)", function () {
        it("signedBlocks[1].previousBlockHash = random → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof signed-block structural proof", function () {
        it("invalid author signature → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;
            await h.tamper.stubConstructDispute(3, (dispute) => {
                if (dispute.input.stateProof.signedBlocks.length < 2) {
                    throw new Error("Expected at least two signed blocks");
                }
                dispute.input.stateProof.signedBlocks.at(-1)!.signature =
                    dispute.input.stateProof.signedBlocks[0].signature;
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
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("skipped height → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;
            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const index = dispute.input.stateProof.signedBlocks.length - 1;
                if (index < 1)
                    throw new Error("Expected at least two signed blocks");
                await d.rewriteSignedBlockAtIndex(dispute, index, (block) =>
                    d.blockStructWithTransactionHeader(block, {
                        transactionCnt:
                            BigInt(block.transaction.header.transactionCnt) + 1n
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

    describe("stateProof block authored by a non-participant", function () {
        it("valid outsider-authored block → dedicated dispute proof only", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                d.expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await d.rewriteLastSignedBlockAuthorAsOutsider(dispute);
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
                peerIndices: [0, 1, 3]
            });

            const overlappingProofTypes = [
                DisputeFraudProofType.DisputeInvalidBlockStructure,
                DisputeFraudProofType.DisputeInvalidStateProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            ].map((type) => String(toSolidityDisputeFraudProofType(type)));
            // Peer 2 is deliberately disconnected before the state proof is
            // built, so it cannot audit against the resulting snapshot.
            for (const peer of h.getFilteredPeers([0, 1, 3])) {
                const proofTypes = await h
                    .control(peer)
                    .query.getDisputeFraudProofTypes()
                    .request();
                expect(proofTypes).to.include(
                    String(
                        toSolidityDisputeFraudProofType(
                            DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                        )
                    )
                );
                for (const overlappingType of overlappingProofTypes) {
                    expect(proofTypes).not.to.include(overlappingType);
                }
            }

            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("outsider-authored block with fabricated snapshot hash → fallback transition proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                d.expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                await d.rewriteLastSignedBlockAuthorAsOutsider(
                    dispute,
                    d.randomHash() as Hash
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
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });

            await h.dispute.resolveDisputeWait({ forkId });
        });
    });
});
