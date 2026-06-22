import { ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import Block from "@/models/Block";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";
import { expect } from "chai";

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

            h.tamper.stubConstructDispute(3, async (dispute) => {
                const stateProof = dispute.input.stateProof;
                if (
                    stateProof.milestones.length > 0 ||
                    stateProof.signedBlocks.length === 0
                ) {
                    throw new Error(
                        `Expected 0 milestones + signedBlocks, got milestones=${stateProof.milestones.length} signedBlocks=${stateProof.signedBlocks.length}`
                    );
                }
                const peer = h.getPeer(1);

                const lastSigned = stateProof.signedBlocks.at(-1)!;
                const block = Codec.decode(lastSigned.encodedBlock, Type.Block);

                block.stateSnapshotHash = ZeroHash;
                const blockInstance = await Block.fromBlockStruct(
                    block,
                    peer.signer
                );
                stateProof.signedBlocks[stateProof.signedBlocks.length - 1] =
                    blockInstance.signedBlock;
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
            await TestSession.expectFirstDetachedError({
                includes: "unknown snapshot",
                required: false
            });
        });
    });

    describe("stateProof.signedBlocks[-1].encodedBlock.messageBlocks injected with forged inbound message", function () {
        it("messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                const stateProof = dispute.input.stateProof;
                if (
                    stateProof.milestones.length > 0 ||
                    stateProof.signedBlocks.length === 0
                ) {
                    throw new Error(
                        `Expected 0 milestones + signedBlocks, got milestones=${stateProof.milestones.length} signedBlocks=${stateProof.signedBlocks.length}`
                    );
                }

                const peer = h.getPeer(1);
                const lastSigned = stateProof.signedBlocks.at(-1)!;
                const block = Codec.decode(lastSigned.encodedBlock, Type.Block);

                const fakeMessage: MessageStruct = {
                    messageType: ethers.hexlify(ethers.randomBytes(32)),
                    participant: peer.address,
                    balance: { amount: 1n, data: "0x" },
                    data: ethers.hexlify(ethers.randomBytes(32))
                };
                const fakeMessageBlock: MessageBlockStruct = {
                    previousBlockHash: ethers.ZeroHash as Hash,
                    blockHeight: 1n,
                    messages: [fakeMessage],
                    totalBalance: { amount: 1n, data: "0x" },
                    timestamp: BigInt(Clock.getTimeInSeconds())
                };

                block.messageBlocks = [fakeMessageBlock];

                const blockInstance = await Block.fromBlockStruct(
                    block,
                    peer.signer
                );
                stateProof.signedBlocks[stateProof.signedBlocks.length - 1] =
                    blockInstance.signedBlock;
            });

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
            await TestSession.expectFirstDetachedError({
                includes: "unknown snapshot",
                required: false
            });
        });
    });

    describe("stateProof.signedBlocks[1].previousBlockHash = random (inter-block linkage break)", function () {
        // Off-chain catches the linkage break in block replay and produces a
        // DisputeInvalidBlockInStateProofApplyFraudProof, which the on-chain handler
        // _handleDisputeInvalidBlockInStateProofApplyFraudProof (DisputeFraudProofFacet.sol:561)
        // rejects (returns address(0)) → ErrorInvalidFraudProof, so the dispute is never killed.
        // Keep pending until off-chain/on-chain apply are reconciled.
        // (issue #356; docs/trds/e2e-reduced-fork-followups.md)
        it.skip("signedBlocks[1].previousBlockHash = random → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                const stateProof = dispute.input.stateProof;
                expect(
                    stateProof.milestones.length,
                    "expected 0 milestones for signedBlocks-only path"
                ).to.equal(0);
                expect(
                    stateProof.signedBlocks.length,
                    "need ≥2 signedBlocks to break inter-block linkage"
                ).to.be.greaterThanOrEqual(2);
                await h.tamper.rewriteSignedBlockAtIndex(dispute, 1, (bs) => ({
                    ...bs,
                    previousBlockHash: randomHash() as Hash
                }));
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
            await TestSession.expectFirstDetachedError({
                includes: "unknown snapshot",
                required: false
            });
        });
    });
});
