import { ethers, ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, addressesEqual } from "@/utils";
import Block from "@/models/Block";
import {
    MathTestSession as TestSession,
    expectSignedBlocksOnlyStateProof
} from "@test/harness";
import {
    hash as randomHash,
    blockStructWithTransactionHeader
} from "@test/factory";
import { Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

describe("E2E: dispute validation", function () {
    describe("Calldata path", function () {
        it("DisputeInvalidStateProof: milestones and signedBlocks both non-empty", async function () {
            const h = TestSession.getHarness();
            // preDisputeSetupCalldataPath produces a milestones-only state proof.
            await h.scenario.preDisputeSetupCalldataPath();

            // Inject an extra signedBlock alongside the real milestones.
            // verifyStateProof rejects any proof where both arrays are non-empty.
            // Copy a real milestone block so headers match dispute.input (factory.signedBlock
            // uses a dummy channelId which would trigger DisputeStateProofHeaderMismatch).
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

    describe("On-chain slashes not in snapshot", function () {
        it("InvalidDisputeReason: onChainSlashes contains address not in latestStateSnapshot participants", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(4, 2, {
                timeConfig: { evidenceTime: 8 }
            });

            // peer 1 misbehaves and gets slashed. After fork resolution, peer 1's
            // address is in the on-chain onChainSlashes registry, but NOT in
            // the new snapshot's participants.
            const slashedAddress = h.getPeer(1).address;
            await h.scenario.disputeAndResolve({
                maliciousPeerIndex: 1,
                forkSettleTimeoutMs: 15000,
                disputesCommittedTimeoutMs: 10000
            });
            await h.assert.snapshot.onChainSnapshotChangedWait({
                previousForkId: h.activeForkId!,
                timeoutMs: 15000
            });

            await h.transition.advanceState({
                waitForPeers: [0, 2, 3]
            });
            h.event.resetEventSpies();
            h.contextApi.captureOriginalFork();

            h.tamper.stubConstructDispute(3, async (dispute) => {
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.selfRemoval = false;
                dispute.input.onChainSlashes = [slashedAddress];
            });

            await h.byzantine.submitInvalidStateTransitionBlock(2);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [3],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.InvalidDisputeReason,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 15000
            });
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
            h.tamper.stubConstructDispute(0, async (dispute) => {
                await h.tamper.truncateStateProofToHeight(dispute, {
                    disputerPeerIndex: 0,
                    targetHeight: 2
                });
            });

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

    it("Future block in state proof: honest peers don't fast-forward", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 3, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 6,
                chainFallbackTime: 2,
                evidenceTime: 6
            }
        });

        const forkId = h.activeForkId!;

        // Suppress peer 3's outbound block broadcast
        h.byzantine.stubBroadcast(3);
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 3 });

        await h.transition.peerWrite({ peer: 3, waitForPeers: [3] });

        // Verify the asymmetric storage state: peer 3 has block 3,
        // honest peers still at block 2.
        const peer3Latest = h
            .getPeer(3)
            .stateManager.storage.blocks.getLatestBlock(forkId)!;
        if (peer3Latest.height !== 3) {
            throw new Error(
                `expected peer 3 to have height 3 after suppressed write, got ${peer3Latest.height}`
            );
        }
        for (const honestIndex of [0, 1, 2]) {
            const honestLatest = h
                .getPeer(honestIndex)
                .stateManager.storage.blocks.getLatestBlock(forkId)!;
            if (honestLatest.height > 2) {
                throw new Error(
                    `expected honest peer ${honestIndex} at height == 2, got ${honestLatest.height} (broadcast suppression failed)`
                );
            }
        }
        h.event.resetEventSpies();

        // Peer 3 files a self-removal dispute. the lastest block in the state proof is block 3.
        await h.tamper.postTamperedDispute(3, (dispute) => {
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });

        // confirm the latest block in the state proof is block 3
        const tampered = h.context.tamperedDisputes.at(-1)!;
        const proofTopBlock = await h
            .getLocalDiamond(0)
            .getLatestBlockFromStateProof(tampered.input.stateProof);
        const [hasBlock, latest] = proofTopBlock;
        if (
            !hasBlock ||
            Number(latest.transaction.header.transactionCnt) !== 3
        ) {
            throw new Error(
                `dispute state proof must reference block 3 (got hasBlock=${hasBlock}, height=${
                    hasBlock
                        ? Number(latest.transaction.header.transactionCnt)
                        : "n/a"
                })`
            );
        }

        await h.assert.dispute.committedWait({
            peersIndices: [0, 1, 2],
            expectedCount: 1,
            timeoutMs: 10000
        });

        // confirm other peers did not modify their local state forward, their tip is at block height 2
        for (const honestIndex of [0, 1, 2]) {
            const peer = h.getPeer(honestIndex);
            const latestBlock =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            if (!latestBlock) {
                throw new Error(
                    `peer ${honestIndex} has no latest block on the original fork`
                );
            }
            if (latestBlock.height > 2) {
                throw new Error(
                    `peer ${honestIndex} fast-forwarded on original fork: height ${latestBlock.height} > 2 — height-above attack succeeded (PROTOCOL GAP)`
                );
            }
        }

        await h.dispute.resolveDisputeWait({
            assertMaliciousRemoved: false
        });
    });

    describe("selfRemoval", function () {
        it("valid selfRemoval=true → disputer removed from participant set", async function () {
            const h = TestSession.getHarness();
            // Larger agreementTime avoids writer-timeout disputes racing self-removal.
            await h.scenario.preDisputeSetup({
                timeConfig: { agreementTime: 8, evidenceTime: 4 }
            });

            const leaverIndex = 1;
            const leaverAddress = h.getPeer(leaverIndex).address;

            // forceExit yields a valid self-removal dispute; post untampered.
            h.getPeer(leaverIndex).stateManager.storage.forceExit.setForceExit(
                true
            );
            // Voluntary exit: skip sync barrier, don't mark malicious.
            h.context.leftChannelPeerIndices = [
                ...h.context.leftChannelPeerIndices,
                leaverIndex
            ];

            await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
                markMalicious: false
            });

            const remainingPeerIndices = h
                .getPeersForTransitionSyncBarrier()
                .map((p) => p.index);

            // One dispute commits on-chain.
            await h.assert.dispute.committedWait({
                peersIndices: remainingPeerIndices,
                expectedCount: 1
            });

            // Nobody should kill a valid self-removal dispute.
            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                [...remainingPeerIndices, leaverIndex],
                { durationMs: 4000 }
            );

            await h.dispute.resolveDisputeWait({
                assertMaliciousRemoved: false,
                honestPeerIndices: remainingPeerIndices
            });

            await h.assert.sync.participantCount({ expectedCount: 2 });

            for (const peer of h.getPeersForTransitionSyncBarrier()) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(
                    participants.some((p) => addressesEqual(p, leaverAddress)),
                    `Peer ${peer.index} still has self-removed peer ${leaverIndex} in participants`
                ).to.equal(false);
            }
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

        it("TimeoutTooEarly NOT raised when timeout dispute is valid", async function () {
            const h = TestSession.getHarness();
            // 2 transitions → peer 2 is next to write but never does

            await h.scenario.preDisputeSetup();
            // Mark the non-writer up front so honest-peer barriers (committedWait,
            // resolveDisputeWait) exclude peer 2.
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

            // Natural timeout: peer 2 never authors.
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1],
                timeoutMs: 15000
            });

            // No honest peer should fire onDisputeKilled and none
            // should store ANY dispute fraud proof
            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                [0, 1],
                { durationMs: 3000, maxCount: 0 }
            );
            for (const peer of [0, 1]) {
                const proofs = h.query
                    .getPeerStorage(peer)
                    .disputeFraudProofs.getDisputeFraudProofs();
                if (proofs.length > 0) {
                    const types = proofs.map((p) => p.proofType).join(", ");
                    throw new Error(
                        `Peer ${peer} stored ${proofs.length} dispute fraud proof(s) on a valid timeout dispute (types: ${types}) — pipeline false positive`
                    );
                }
            }

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });

        it("TimeoutThreshold: timeout claimed at fully-signed block height", async function () {
            const h = TestSession.getHarness();
            // Leaver disputes without signing post-leave block 1 so validators reach TimeoutThreshold (not DisputeNotLatestState).
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { agreementTime: 2, evidenceTime: 8 }
            });

            // Skip leave snapshot so peer 0 stays dispute-eligible on-chain.
            const peer0Sm = h.getPeer(0).stateManager;
            peer0Sm.postStateSnapshot = async () => undefined;

            // Tamper peer 0's scheduled timeout dispute: proof to H-1=0, claim height 1 / block-1 author.
            h.tamper.stubConstructDispute(
                0,
                async (dispute, _confirmation, auditingData) => {
                    const corruptedAuditingData =
                        await h.tamper.truncateStateProofToHeight(dispute, {
                            disputerPeerIndex: 0,
                            targetHeight: 0
                        });

                    Object.assign(auditingData!, corruptedAuditingData);
                    const forkId = h.activeForkId!;
                    const blockAtH = h
                        .getPeer(1)
                        .stateManager.storage.blocks.getBlock(forkId, 1)!;
                    dispute.input.timeout.blockHeight = 1n;
                    dispute.input.timeout.participant = blockAtH.author;
                },
                { markMalicious: false }
            );

            await h.transition.advanceState({
                txFn: (c) => c.leaveChannel(),
                waitForFinalization: true
            });
            const remaining = [1, 2, 3];
            h.context.leftChannelPeerIndices = [0];

            // Isolate peer 0 so they don't locally sign block 1 (would trip DisputeNotLatestState).
            await h.byzantine.disconnect(0);
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            await h.transition.advanceState({
                waitForPeers: remaining,
                waitForFinalization: true
            });

            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();

            // Peer 0 stuck before block 1; background timeout fires → stub tamper → TimeoutThreshold on 1/2/3.
            await h.event.waitForPeers("onDisputeKilled", [1, 2, 3], 1, {
                mode: "atLeast",
                timeoutMs: 15000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutThreshold,
                timeoutMs: 10000
            });
            // Dispute path kills tampered claim; slash/eligible-set update still settles fork.
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 20000,
                assertMaliciousRemoved: false
            });
        });

        it("TimeoutCalldataPosted: timeout claimed at block whose calldata is on-chain", async function () {
            const h = TestSession.getHarness();
            // Peer 0 leaves with snapshot suppressed (stays dispute-eligible).
            //  Peer 3 withholds confirms → incomplete block-1 union → author posts calldata; peers 1/2 set onChainTimestamp.
            // Peer 2 never writes H=2 so a real timeout fires; tamper reframes peer 0's dispute (truncate proof, blame peer 1 @ H=1, isForced past calldata upload guard).
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { agreementTime: 2, evidenceTime: 12 }
            });

            const peer0Sm = h.getPeer(0).stateManager;
            peer0Sm.postStateSnapshot = async () => undefined;

            // Falsely blame peer 1 @ H=1 (that block exists + calldata on-chain), truncate proof, isForced clears upload guard.
            h.tamper.stubConstructDispute(
                0,
                async (dispute, _confirmation, auditingData) => {
                    const corruptedAuditingData =
                        await h.tamper.truncateStateProofToHeight(dispute, {
                            disputerPeerIndex: 0,
                            targetHeight: 0
                        });
                    Object.assign(auditingData!, corruptedAuditingData);
                    const forkId = h.activeForkId!;
                    const blockAtH = h
                        .getPeer(1)
                        .stateManager.storage.blocks.getBlock(forkId, 1)!;
                    dispute.input.timeout.blockHeight = 1n;
                    dispute.input.timeout.participant = blockAtH.author;
                    dispute.input.timeout.isForced = true;
                },
                { markMalicious: false }
            );

            await h.transition.advanceState({
                txFn: (c) => c.leaveChannel(),
                waitForFinalization: true
            });
            h.context.leftChannelPeerIndices = [0];
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            // Peer 3 withholds confirms → incomplete union → author posts calldata.
            h.byzantine.stubBroadcast(3);

            // peer1 write the next block
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [1, 2, 3],
                waitForFinalization: false
            });

            // peer1 posts calldata
            await h.event.waitForPeers("onBlockCalldataPosted", [1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 15000
            });

            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();
            //  peer 2 never writes, so the timeout fires naturally.

            // peer 1 and 2 kill the tampered dispute by peer 0
            await h.event.waitForPeers("onDisputeKilled", [1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutCalldataPosted,
                peerIndices: [1, 2],
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 25000,
                assertMaliciousRemoved: false
            });
        });
    });

    describe("Header mismatch", function () {
        it("DisputeStateProofHeaderMismatch: signedBlock header channelId ≠ input", async function () {
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

        it("DisputeStateProofHeaderMismatch: signedBlock header forkId ≠ input", async function () {
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

        it("DisputeStateProofHeaderMismatch: milestone header channelId ≠ input", async function () {
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

        it("DisputeStateProofHeaderMismatch: milestone header forkId ≠ input", async function () {
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

    describe("Inbound hash not in chain", function () {
        it("DisputeInboundHashNotInChain: junk hash", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(0, (d) => {
                d.input.latestInboundMessageBlockHash = randomHash() as Hash;
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInboundHashNotInChain,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });

        it("DisputeInboundHashNotInChain: genesis hash with non-zero height", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(0, (d) => {
                d.input.latestInboundMessageBlockHash = ZeroHash as Hash;
                d.input.lastInboundMessageBlockHeight = 999999n;
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInboundHashNotInChain,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
