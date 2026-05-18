import { ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import Block from "@/models/Block";
import {
    MathTestSession as TestSession,
    DisputeTampering,
    expectSignedBlocksOnlyStateProof
} from "@test/harness";
import { Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";

// Trello card Case 3: signedBlocks-only stateProof. Must build on genesis and
// blocks must be linked to each other. Subcases break the linkage or block content
// in various ways and assert the fraud-proof pipeline kills the dispute.

describe("E2E: dispute validation / stateProof / Case 3 (signedBlocks-only)", function () {
    describe("dispute.input.latestStateSnapshotHash tampered (no calldata, peers fully synced)", function () {
        it("→ DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.stubConstructDispute(3, (d) => {
                expectSignedBlocksOnlyStateProof(d.input.stateProof);
                DisputeTampering.tamperInvalidStateProof(d);
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
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("dispute.input.latestStateSnapshotHash tampered (no calldata, auditor at genesis)", function () {
        it("→ DisputeInvalidStateProof (pipeline path, incomplete local storage)", async function () {
            const h = TestSession.getHarness();
            // peer 2 disconnects before the 2 state transitions, so it holds the
            // genesis block (produced before disconnect) but not the signedBlocks that
            // appear in the dispute proof
            await h.scenario.preDisputeSetupDisconnectedPeer({
                timeConfig: { p2pTime: 3 }
            });

            h.tamper.stubConstructDispute(3, (d) => {
                expectSignedBlocksOnlyStateProof(d.input.stateProof);
                DisputeTampering.tamperInvalidStateProof(d);
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });
            // peer 2 has no P2P connections but still monitors on-chain events.
            // It is the peer we require to kill the dispute to confirm the pipeline path works with incomplete storage.
            await h.event.waitForPeers("onDisputeKilled", [2], 1, {
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

    describe("stateProof.signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash (linkage break)", function () {
        it("→ DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
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
        it("→ DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
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
        });
    });
});
