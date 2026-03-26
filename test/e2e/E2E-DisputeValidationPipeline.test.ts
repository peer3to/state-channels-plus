import { ethers, ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import Block from "@/models/Block";
import { TestSession, PeerTestHarness } from "@test/harness";
import * as factory from "@test/factory";
import { Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Dispute Validation Pipeline", function () {
    describe("Invalid Latest State Proof (no calldata)", function () {
        it("should kill dispute and store DisputeInvalidStateProof when latestStateSnapshotHash is tampered (no-calldata path)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.delayDisputeForPeers([0, 2]);

            // Stub peer 1's dispute construction to corrupt latestStateSnapshotHash.
            // postedAuditingData remains false → no-calldata path.
            h.tamper.stubConstructDispute(1, (dispute) => {
                dispute.input.latestStateSnapshotHash = hash("0x42");
            });

            await h.byzantine.submitInvalidStateTransitionBlock(2);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Verify State Proof (calldata path)", function () {
        it("should kill dispute and store DisputeInvalidStateProof when stateProof has both milestones and signedBlocks", async function () {
            const h = TestSession.getHarness();
            // preDisputeSetupCalldataPath produces a milestones-only state proof.
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.delayDisputeForPeers([0, 1, 2], 3000);

            // Inject a garbage signedBlock alongside the real milestones.
            // verifyStateProof rejects any proof where both arrays are non-empty.
            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "Expected milestones in calldata-path state proof"
                    );
                }
                const validSignedBlock = factory.signedBlock();
                d.input.stateProof.signedBlocks = [
                    {
                        encodedBlock: validSignedBlock.encodedBlock,
                        signature: validSignedBlock.signature
                    }
                ];
            });

            await h.byzantine.submitDoubleSignBlock(0);

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait();
        });

        it("should kill dispute and store DisputeInvalidStateProof when a milestone has no blockConfirmations", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.delayDisputeForPeers([0, 1]);

            // Empty blockConfirmations on the first milestone causes
            // _isMilestoneFinalWithExpectedParticipants to return (false, 0)
            // immediately, making _tryVerifyMilestones return false.
            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "Expected milestones in calldata-path state proof"
                    );
                }
                d.input.stateProof.milestones[0].blockConfirmations = [];
            });

            await h.byzantine.submitDoubleSignBlock(0);

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait();
        });

        it("should kill dispute and store DisputeInvalidStateProof when latestStateSnapshotHash is tampered (with calldata)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            // Slow down peers 0, 1 so the stubbed dispute from peer 3 is uploaded first
            h.tamper.delayDisputeForPeers([0, 1]);

            h.tamper.stubConstructDispute(3, (d) => {
                d.input.latestStateSnapshotHash = hash("0x42");
            });

            await h.byzantine.submitDoubleSignBlock(0);

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("No Auditing Data — Last Milestone Not Final", function () {
        it("should kill dispute and store DisputeLastMilestoneNotFinalAndNoAuditingData when disputer posts without auditing data and last milestone is not final", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });

            //  peer 0 turn
            await h.transition.advanceState({ waitForPeers: [0, 1] });

            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(2, (dispute) => {
                dispute.postedAuditingData = false;
            });

            // Peer 1 submits a faulty block
            await h.byzantine.submitInvalidStateTransitionBlock(1);

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("State Proof Block Pipeline", function () {
        it("should kill dispute and store DisputeInvalidBlockInStateProofApplyFraudProof(BlockInvalidStateTransition) when signedBlocks block has corrupted encodedBlock", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.delayDisputeForPeers([0, 1, 2]);

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

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait();
        });

        it("should kill dispute and store DisputeInvalidBlockInStateProofApplyFraudProof(ForgedInboundMessageBlock) when a state proof block contains a forged inbound message", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            h.tamper.delayDisputeForPeers([0, 1, 2]);

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

            await h.event.waitForPeers("onDisputeKilled", [0], 1);
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("On-Chain Slashes Not Subset", function () {
        it("should kill dispute and store DisputeOnChainSlashesNotSubset when onChainSlashes contains an address not actually slashed on-chain", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            const fakeSlashedAddress = h.getPeer(0).address;
            h.tamper.stubConstructDispute(1, async (dispute) => {
                dispute.input.onChainSlashes = [
                    ...dispute.input.onChainSlashes,
                    fakeSlashedAddress
                ];
            });
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

            await h.byzantine.submitForgedInboundMessageBlock(2);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeOnChainSlashesNotSubset
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Balance Invariant", function () {
        it("should kill dispute and store DisputeInvalidBalanceInvariant when the balance invariant fails", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.delayDisputeForPeers([0, 1]);

            // Corrupt snapshot store
            h.tamper.corruptValidatorSnapshotForBalanceInvariant(2);

            await h.byzantine.submitDoubleSignBlock(1);

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBalanceInvariant
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Dispute Not Latest State", function () {
        it("should kill dispute and store DisputeNotLatestState when disputer posts state proof at an older block height than they have actually signed", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.transition.advanceState({ count: 3 });
            //  now it is peer 2 turn, current block height is 4 (5 transactions done)

            // Stub peer 0's constructDispute: truncate state proof to height 2 so the dispute
            // shows latest at block 2, while peer 0 has actually signed block 4.
            h.tamper.stubConstructDispute(0, (dispute) =>
                h.tamper.truncateStateProofToHeight(dispute, 0, 2)
            );

            //  peer 1 submits a double sign block
            await h.byzantine.submitDoubleSignBlock(1);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeNotLatestState
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Timeout Fraud Proofs", function () {
        it("should kill dispute and store TimeoutNotLinkedToLatestState when timeout.blockHeight does not equal latestBlockHeight + 1", async function () {
            const h = TestSession.getHarness();
            // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
            await h.lifecycle.timeoutSetup(3);
            await h.assert.sync.peersInSyncWait();
            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();

            // Peer 2 submits a timeout dispute with the wrong blockHeight.
            h.tamper.stubConstructDispute(2, async (dispute) => {
                const localDiamond = h.getLocalDiamond(1);
                const [hasBlock, latestBlock] =
                    await localDiamond.getLatestBlockFromStateProof(
                        dispute.input.stateProof
                    );
                const expectedHeight = hasBlock
                    ? Number(latestBlock.transaction.header.transactionCnt) + 1
                    : 0;
                dispute.input.timeout.blockHeight = expectedHeight + 1;
            });

            // No action needed — peer 0 never writes, so the timeout fires naturally.
            // Peer 1 will upload a valid timeout dispute; peer 2's dispute is tampered
            // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
            await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutNotLinkedToLatestState
            });
            // mark peer 0 as malicious
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            await h.dispute.resolveDisputeWait();
        });

        it("should kill dispute and store TimeoutParticipantNotNext when timeout.participant is not the next peer to write", async function () {
            const h = TestSession.getHarness();
            // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
            await h.scenario.preDisputeSetup();

            // Peer 0 submits a timeout dispute with the wrong participant.
            h.tamper.stubConstructDispute(0, (dispute) => {
                //  blame peer 1
                dispute.input.timeout.participant = h.getPeer(1).address;
            });

            // No action needed — peer 2 never writes, so the timeout fires naturally.
            // Peer 1 will upload a valid timeout dispute; peer 0's dispute is tampered
            // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
            await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutParticipantNotNext
            });
            await h.dispute.resolveDisputeWait();
        });

        it("should kill dispute and store TimeoutTooEarly when timeout dispute is posted before the timeout wait period has elapsed", async function () {
            const h = TestSession.getHarness();
            // 2 transitions → peer 2 is next to write but never does.
            await h.scenario.preDisputeSetup();

            //  Store timeout for peer 0 so constructDispute can build a valid dispute struct.
            const forkId = h.activeForkId!;
            const nextPeer = await h.query.getNextPeerToWrite();
            const latestBlock = h
                .getPeer(0)
                .stateManager.storage.blocks.getLatestBlock(forkId)!;
            const blockHeight = BigInt(Number(latestBlock.height) + 1);
            h.getPeer(0).stateManager.storage.timeout.storeTimeout(forkId, {
                participant: nextPeer.address,
                blockHeight,
                minTimeStamp: BigInt(Clock.getTimeInSeconds()),
                isForced: false,
                previousBlockProducer: ethers.ZeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: "0x"
            });

            // Post the dispute immediately
            await h.tamper.postTamperedDispute(0, () => {});

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly
            });
            await h.dispute.resolveDisputeWait();
        });

        // it.skip("should kill dispute and store TimeoutThreshold when all participants have already signed the block claimed as timed out", async function () {
        //     // TODO: Requires the state proof to go to block N while block N+1 is
        //     // already fully signed. Needs a harness helper for state-proof truncation
        //     // that consistently re-hashes derived fields (3A, 3B).
        // });

        // it.skip("should kill dispute and store TimeoutCalldataPosted when the block at timeout.blockHeight has been posted on-chain as calldata", async function () {
        //     // TODO: Requires posting block calldata on-chain first, then waiting
        //     // evidenceTime (to pass 3F-3) before submitting a tampered timeout dispute.
        // });
    });

    describe("Invalid Output State", function () {
        it("should kill dispute and store DisputeInvalidOutputState when outputSnapshotDataHash is corrupted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(2, async (dispute) => {
                dispute.outputSnapshotDataHash = hash("0x42");
            });
            h.tamper.delayDisputeForPeers([0, 1]);

            await h.byzantine.submitDoubleSignBlock(1);

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidOutputState
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
