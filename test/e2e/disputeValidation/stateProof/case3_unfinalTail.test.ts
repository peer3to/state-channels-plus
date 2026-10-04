import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Hash } from "@/types/types";
import {
    expectUnfinalTailStateProof,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";

// Case 3: peer 2 never signs, so no block is final by everyone and no block
// is threshold-final: the proof is one run from the genesis block 0, the
// whole run is the unfinal tail, and the dispute posts its auditing data.
// Subcases break the tail's linkage or block content and assert the
// fraud-proof pipeline kills the dispute.

// latestStateSnapshotHash tamper variants live in
// disputeInputFields/latestStateSnapshotHash.test.ts.

describe("E2E: dispute validation / stateProof / Case 3 (unfinal tail)", function () {
    describe("stateProof.milestones[-1].blockConfirmations[0].previousBlockHash = random (wrong genesis link)", function () {
        it("height 0 first block with wrong genesis link → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                const milestones = dispute.input.stateProof.milestones;
                const m = milestones.length - 1;
                const confirmations = milestones[m].blockConfirmations;

                await d.rewriteMilestoneSignedBlockAtIndex(
                    dispute,
                    m,
                    0,
                    (bs) => ({
                        ...bs,
                        previousBlockHash: d.randomHash() as Hash
                    })
                );
                // relink the rest, so only the genesis link is broken
                for (let j = 1; j < confirmations.length; j++) {
                    const previousBlockHash = d.hash(
                        confirmations[j - 1].signedBlock.encodedBlock
                    ) as Hash;
                    await d.rewriteMilestoneSignedBlockAtIndex(
                        dispute,
                        m,
                        j,
                        (bs) => ({ ...bs, previousBlockHash })
                    );
                }
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });
            const [tampered] = await h.tamper.getTamperedDisputes(3);
            expectUnfinalTailStateProof(tampered.input.stateProof);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof.milestones[-1].blockConfirmations[-1].encodedBlock.messageBlocks injected with forged inbound message", function () {
        it("messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(
                3,
                async (dispute, sm, args) => {
                    const svc = sm.p2pManager.localRpc.dispute;
                    await svc.rewriteLastMilestoneSignedBlockInDispute(
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
                initiatedWithAuditingData: true
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1);
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("stateProof.milestones[-1].blockConfirmations[1].previousBlockHash = random (inter-block linkage break)", function () {
        it("tail block 1 previousBlockHash = random → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                await d.rewriteMilestoneSignedBlockAtIndex(
                    dispute,
                    dispute.input.stateProof.milestones.length - 1,
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
    });

    describe("stateProof tail block structural proof", function () {
        it("invalid author signature → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;
            await h.tamper.stubConstructDispute(3, (dispute) => {
                const confirmations =
                    dispute.input.stateProof.milestones.at(
                        -1
                    )!.blockConfirmations;
                confirmations.at(-1)!.signedBlock.signature =
                    confirmations[0].signedBlock.signature;
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
    });

    describe("stateProof tail block authored by a non-participant", function () {
        it("valid outsider-authored block → dedicated dispute proof only", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                await sm.p2pManager.localRpc.dispute.rewriteLastMilestoneBlockAuthorAsOutsider(
                    dispute
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
            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
                peerIndices: [0, 1, 3]
            });

            // Peer 2 is disconnected before the proof is built, so it cannot
            // audit; the others store the dedicated proof only.
            const dedicated = String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                )
            );
            for (const peer of h.getFilteredPeers([0, 1, 3]))
                expect(
                    await h
                        .control(peer)
                        .query.getDisputeFraudProofTypes()
                        .request()
                ).to.deep.equal([dedicated]);

            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("dispute.postedAuditingData = false with a broken unfinal tail", function () {
        it("omitted auditing data → DisputeLastMilestoneNotFinalAndNoAuditingData before the tail is judged", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const d = sm.p2pManager.localRpc.dispute;
                // a replay fault: the structure checks before availability
                // would catch a linkage break first
                await d.rewriteLastMilestoneSignedBlockInDispute(
                    dispute,
                    (bs) => ({ ...bs, stateSnapshotHash: d.zeroHash })
                );
                dispute.postedAuditingData = false;
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });
            const [tampered] = await h.tamper.getTamperedDisputes(3);
            expectUnfinalTailStateProof(tampered.input.stateProof);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });
    });
});
