import { ethers, ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import Block from "@/models/Block";
import { PeerTestHarness, TestSession } from "@test/harness";
import { Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: dispute validation", function () {
    describe("Calldata path", function () {
        it("DisputeInvalidStateProof: milestones and signedBlocks both non-empty", async function () {
            const h = TestSession.getHarness();
            // preDisputeSetupCalldataPath produces a milestones-only state proof.
            await h.scenario.preDisputeSetupCalldataPath();

            // Inject an extra signedBlock alongside the real milestones.
            // verifyStateProof rejects any proof where both arrays are non-empty.
            // Copy a real milestone block so headers match dispute.input (upload reverts otherwise:
            // _requireStateProofHeaderChannelMatchesInput; factory.signedBlock uses dummy channelId).
            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "Expected milestones in calldata-path state proof"
                    );
                }
                const src =
                    d.input.stateProof.milestones[0].blockConfirmations[0]
                        .signedBlock;
                d.input.stateProof.signedBlocks = [
                    {
                        encodedBlock: src.encodedBlock,
                        signature: src.signature
                    }
                ];
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
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });

        it("DisputeInvalidStateProof: milestone has no blockConfirmations", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

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
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("No auditing data, last milestone not final", function () {
        it("DisputeLastMilestoneNotFinalAndNoAuditingData: without auditing data", async function () {
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

            await h.assert.dispute.initiatedWait({
                peersIndices: [2],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("State proof block pipeline", function () {
        describe("signedBlocks-only", function () {
            it("DisputeInvalidBlockInStateProofApplyFraudProof: corrupted signedBlock encodedBlock", async function () {
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
                    const block = Codec.decode(
                        lastSigned.encodedBlock,
                        Type.Block
                    );

                    block.stateSnapshotHash = ZeroHash;
                    const blockInstance = await Block.fromBlockStruct(
                        block,
                        peer.signer
                    );
                    stateProof.signedBlocks[
                        stateProof.signedBlocks.length - 1
                    ] = blockInstance.signedBlock;
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
                            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            });

            it("DisputeInvalidBlockInStateProofApplyFraudProof: forged inbound message in block", async function () {
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
                    const block = Codec.decode(
                        lastSigned.encodedBlock,
                        Type.Block
                    );

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
                    stateProof.signedBlocks[
                        stateProof.signedBlocks.length - 1
                    ] = blockInstance.signedBlock;
                });

                // peer 1 double signs
                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: false
                });

                await h.event.waitForPeers("onDisputeKilled", [0], 1);
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            });
        });

        describe("Milestone blockConfirmations", function () {
            it("DisputeInvalidBlockInStateProofApplyFraudProof: last confirmation block inconsistent (txn count)", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    peerCount: 4,
                    timeConfig: { evidenceTime: 6 }
                });
                await h.byzantine.disconnect(3);
                await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
                h.event.resetEventSpies();

                h.tamper.stubConstructDispute(0, async (dispute) => {
                    const stateProof = dispute.input.stateProof;

                    const localDiamond = h.getLocalDiamond(0);
                    const [hasBlock, latestBlock] =
                        await localDiamond.getLatestBlockFromStateProof(
                            stateProof
                        );
                    if (!hasBlock) {
                        throw new Error(
                            "State proof does not contain a block to tamper with"
                        );
                    }

                    latestBlock.transaction.header.transactionCnt =
                        BigInt(latestBlock.transaction.header.transactionCnt) +
                        5n;

                    stateProof.milestones
                        .at(-1)!
                        .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                        Codec.encode(latestBlock, Type.Block);
                });

                await h.byzantine.submitInvalidStateTransitionBlock(1);
                await h.assert.dispute.initiatedAndCommitedWait({
                    peersIndices: [0],
                    initiatedWithAuditingData: false
                });

                await h.event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast",
                    timeoutMs: 10000
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            });
        });
    });

    describe("On-chain slashes not subset", function () {
        it("DisputeOnChainSlashesNotSubset: claims slash for address not slashed on-chain", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            const fakeSlashedAddress = h.getPeer(0).address;
            h.tamper.stubConstructDispute(1, async (dispute) => {
                dispute.input.onChainSlashes = [
                    ...dispute.input.onChainSlashes,
                    fakeSlashedAddress
                ];
            });

            await h.byzantine.submitForgedInboundMessageBlock(2);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [1],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Balance invariant", function () {
        it("DisputeInvalidBalanceInvariant: corrupted validator snapshot", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            // Corrupt snapshot store
            h.tamper.corruptValidatorSnapshotForBalanceInvariant(2);

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [2],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBalanceInvariant,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Not latest state", function () {
        it("DisputeNotLatestState: proof height below last signed", async function () {
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

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeNotLatestState,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("Timeout fraud proofs", function () {
        it("TimeoutNotLinkedToLatestState: blockHeight != latest + 1", async function () {
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
                    DisputeFraudProofType.TimeoutNotLinkedToLatestState,
                timeoutMs: 10000
            });
            // mark peer 0 as malicious
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });

        it("TimeoutParticipantNotNext: participant not next writer", async function () {
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
                    DisputeFraudProofType.TimeoutParticipantNotNext,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });

        it("TimeoutTooEarly: posted before wait period elapses", async function () {
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
                disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly,
                timeoutMs: 10000
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

    describe("Invalid output state", function () {
        it("DisputeInvalidOutputState: corrupted outputSnapshotDataHash", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(2, async (dispute) => {
                dispute.outputSnapshotDataHash = hash("0x42");
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [2],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidOutputState,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
