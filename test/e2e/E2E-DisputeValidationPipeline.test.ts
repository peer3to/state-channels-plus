import { ethers, ZeroHash } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import { TestSession, PeerTestHarness } from "@test/harness";
import { ForkId, Hash } from "@/types/types";
import Clock from "@/Clock";
import type {
    MessageBlockStruct,
    MessageBlockStructOutput,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

PeerTestHarness.setDefaultLogLevel("error");

// ─────────────────────────────────────────────────────────────────────────────
// Faulty block submission
//
// Each test needs a byzantine peer to submit an invalid block FIRST, so that
// honest peers detect the fraud and autonomously raise disputes via the SDK.
// We don't care which specific fraud variant triggers the first dispute — only
// that the subsequent dispute validation pipeline detects the corrupted dispute.
//
// To add new faulty-block variants in the future, add an entry to
// FAULTY_BLOCK_VARIANTS below.
// ─────────────────────────────────────────────────────────────────────────────

type FaultyBlockVariant =
    | "invalidStateTransition"
    | "doubleSign"
    | "forgedInboundMessage";

const FAULTY_BLOCK_VARIANTS: FaultyBlockVariant[] = [
    "invalidStateTransition",
    "doubleSign",
    "forgedInboundMessage"
];

async function submitFaultyBlock(
    h: PeerTestHarness,
    byzantinePeerIndex: number,
    variant?: FaultyBlockVariant,
    options?: { forkId?: ForkId }
): Promise<void> {
    const chosen =
        variant ??
        FAULTY_BLOCK_VARIANTS[
            Math.floor(Math.random() * FAULTY_BLOCK_VARIANTS.length)
        ];

    switch (chosen) {
        case "invalidStateTransition":
            await h.byzantine.submitInvalidStateTransitionBlock(
                byzantinePeerIndex,
                options
            );
            break;
        case "doubleSign":
            await h.byzantine.submitDoubleSignBlock(
                byzantinePeerIndex,
                options
            );
            break;
        case "forgedInboundMessage":
            await h.byzantine.submitForgedInboundMessageBlock(
                byzantinePeerIndex,
                options
            );
            break;
        default: {
            const _exhaustive: never = chosen;
            throw new Error(`Unknown faulty block variant: ${_exhaustive}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: Dispute Validation Pipeline", function () {
    describe("Posted Auditing Data", function () {
        it("should kill dispute and store DisputeInvalidStateProof when state proof fails", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            h.tamper.stubConstructDispute(0, (dispute) => {
                dispute.input.latestStateSnapshotHash = hash("0x42");
            });
            await submitFaultyBlock(h, 1);

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });

            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1,
                honestPeerIndices: [2]
            });
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
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1,
                honestPeerIndices: [0]
            });
        });
    });

    describe("State Proof Block Pipeline", function () {
        // FLAKY
        it("should kill dispute and store DisputeInvalidBlockInStateProofApplyFraudProof(BlockInvalidStateTransition) when a milestone block has a corrupted encodedBlock", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);
            await h.byzantine.disconnect(3);
            // peer 2 turn
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            // Stub peer 0's dispute construction to corrupt the unfinalized block's
            // stateSnapshotHash so the state proof block pipeline fails.
            h.tamper.stubConstructDispute(0, async (dispute) => {
                const stateProof = dispute.input.stateProof;
                const localDiamond = h.getLocalDiamond(0);
                const [hasBlock, latestBlock] =
                    await localDiamond.getLatestBlockFromStateProof(stateProof);
                if (!hasBlock) {
                    throw new Error(
                        "State proof has no block to corrupt for Phase 2 test"
                    );
                }
                latestBlock.stateSnapshotHash = ethers.ZeroHash;
                stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                    Codec.encode(latestBlock, Type.Block);
            });

            // peer 2 double signes
            await h.byzantine.submitDoubleSignBlock(2);

            // wait for dispute to be killed by peer 1 (the only honest peer in the channel)
            await h.event.waitForPeers("onDisputeKilled", [1], 1);
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 2,
                // 0 is includes as a hack to assert that the new fork has 2 participants
                //  need to adjust to have maliciousPeerIndices : (2, the double signer, 0, the byzantine disputer)
                honestPeerIndices: [1, 0]
            });
        });

        // FAILS
        /*
        onDisputeKilled counts not reached within 10000ms, expected: [{"peerId":1,"expectedCount":1}], actual: [{"peerId":1,"actualCount":0}]
        */
        it("should kill dispute and store DisputeInvalidBlockInStateProofApplyFraudProof(ForgedInboundMessageBlock) when a state proof block contains a forged inbound message", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);
            // peer 3 withholds block confirmations so the last milestone has unfinalized blocks
            //  takes the turn of peer 2
            await h.scenario.peerWithUnbroadcastedBlock(3);
            h.event.resetEventSpies();

            const injectForgedMessageBlock = async (
                dispute: any,
                peerIndex: number
            ) => {
                const stateProof = dispute.input.stateProof;
                const localDiamond = h.getLocalDiamond(peerIndex);
                const [hasBlock, latestBlock] =
                    await localDiamond.getLatestBlockFromStateProof(stateProof);
                if (!hasBlock) {
                    throw new Error(
                        "State proof has no block to corrupt for Phase 2 test"
                    );
                }
                const peer = h.getPeer(peerIndex);
                const forkId = latestBlock.transaction.header.forkId as ForkId;
                const blockHeight = Number(
                    latestBlock.transaction.header.transactionCnt
                );
                const previousStateSnapshot =
                    peer.stateManager.storage.getPreviousStateSnapshot({
                        forkId,
                        height: blockHeight
                    });
                if (!previousStateSnapshot) {
                    throw new Error(
                        "No previous state snapshot for forged message block"
                    );
                }
                const latestInboundHash = (previousStateSnapshot.snapshotData
                    .latestInboundMessageBlockHash ?? ZeroHash) as Hash;
                const latestInboundHeight = BigInt(
                    previousStateSnapshot.snapshotData
                        .latestInboundMessageBlockHeight ?? 0n
                );
                const forgedMessage: MessageStruct = {
                    messageType: ethers.hexlify(ethers.randomBytes(32)),
                    participant: peer.address,
                    balance: { amount: 1n, data: "0x" },
                    data: ethers.hexlify(ethers.randomBytes(32))
                };
                const forgedMessageBlock: MessageBlockStruct = {
                    previousBlockHash: latestInboundHash || (ZeroHash as Hash),
                    blockHeight: latestInboundHeight + 1n,
                    messages: [forgedMessage],
                    totalBalance: {
                        amount: forgedMessage.balance.amount,
                        data: "0x"
                    },
                    timestamp: BigInt(Clock.getTimeInSeconds())
                };
                latestBlock.messageBlocks = [
                    forgedMessageBlock as MessageBlockStructOutput
                ];
                stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                    Codec.encode(latestBlock, Type.Block);
            };
            h.tamper.stubConstructDispute(0, (d) =>
                injectForgedMessageBlock(d, 0)
            );

            // peer 2 double signs
            await h.byzantine.submitDoubleSignBlock(2);

            await h.event.waitForPeers("onDisputeKilled", [1], 1);
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 2,
                honestPeerIndices: [1]
            });
        });
    });

    describe("Auditing Data Hash Mismatch", function () {
        // FAILS
        /*
        onDisputeKilled counts not reached within 10000ms, expected: [{"peerId":1,"expectedCount":1}], actual: [{"peerId":1,"actualCount":0}]
        */
        it("should kill dispute and store DisputeInvalidAuditingDataHash when disputeAuditingDataHash is tampered (with calldata)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);

            await h.byzantine.disconnect(3);
            // peer 2 turn
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(0, (d) => {
                if (!d.postedAuditingData) {
                    throw new Error("Dispute does not have postedAuditingData");
                }
                d.input.disputeAuditingDataHash = hash("0x42");
            });

            // peer 2 double signs

            await h.byzantine.submitDoubleSignBlock(2);

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 2,
                honestPeerIndices: [1, 0]
            });
        });
    });

    // TESTs BELOW ARE NOT DOEN YET (got stuck debugging the ones above)

    // ─────────────────────────────────────────────────────────────────────────────

    // describe("Invalid Latest State Proof (no calldata)", function () {
    //     it("should kill dispute and store DisputeInvalidStateProof when latestStateSnapshotHash is tampered (no-calldata path)", async function () {
    //         const h = TestSession.getHarness();
    //         await h.scenario.preDisputeSetup();

    //         // Stub peer 1's dispute construction to corrupt latestStateSnapshotHash.
    //         // postedAuditingData remains false → no-calldata path.
    //         h.tamper.stubConstructDispute(1, async (dispute) => {
    //             dispute.input.latestStateSnapshotHash = hash("0x42");
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

    //         await submitFaultyBlock(h, 1);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType:
    //                 DisputeFraudProofType.DisputeInvalidStateProof
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 1 });
    //         await h.assert.sync.forkChangedWait();
    //     });
    // });

    // describe( "On-Chain Slashes Not Subset", function () {
    //     it("should kill dispute and store DisputeOnChainSlashesNotSubset when onChainSlashes contains an address not actually slashed on-chain", async function () {
    //         const h = TestSession.getHarness();
    //         await h.scenario.preDisputeSetup();

    //         // Stub peer 1's dispute construction to append a fake slashed address.
    //         // All prior checks pass (stateProof and auditingDataHash are untouched).
    //         const fakeSlashedAddress = ethers.Wallet.createRandom().address;
    //         h.tamper.stubConstructDispute(1, async (dispute) => {
    //             dispute.input.onChainSlashes = [
    //                 ...dispute.input.onChainSlashes,
    //                 fakeSlashedAddress
    //             ];
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

    //         await submitFaultyBlock(h, 1);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType:
    //                 DisputeFraudProofType.DisputeOnChainSlashesNotSubset
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 1 });
    //         await h.assert.sync.forkChangedWait();
    //     });
    // });

    // describe("Balance Invariant", function () {
    //     it.skip("should kill dispute and store DisputeInvalidBalanceInvariant when the balance invariant fails", async function () {
    //         // TODO: verifyBalanceInvariantCheckSnapshot is called with values from
    //         // LOCAL validator storage (not from the dispute struct itself).
    //         // Making this fail while passing phases 1–3C requires corrupting the
    //         // latestStateSnapshot snapshotData in a way that passes 3A and 3B but
    //         // fails the balance invariant — which needs a dedicated harness action
    //         // that corrupts the in-memory state snapshot store before validation.
    //     });
    // });

    // describe("Dispute Not Latest State", function () {
    //     it.skip("should kill dispute and store DisputeNotLatestState when disputer posts state proof at an older block height than they have actually signed", async function () {
    //         // TODO: Requires rolling back the state proof to height N-1 while keeping
    //         // disputeAuditingDataHash and latestStateSnapshotHash consistent with N-1
    //         // (so 3A and 3B pass), while the agreementManager finds the disputer's
    //         // signature on block N → DisputeNotLatestState.
    //         // Needs a dedicated harness helper for consistent state-proof truncation.
    //     });
    // });

    // describe("Timeout Fraud Proofs", function () {
    //     it("should kill dispute and store TimeoutNotLinkedToLatestState when timeout.blockHeight does not equal latestBlockHeight + 1", async function () {
    //         const h = TestSession.getHarness();
    //         await h.scenario.preDisputeSetup();

    //         // Stub peer 1's dispute construction: set timeout.blockHeight to
    //         // expectedHeight + 1 (off by one) so Phase 3F-1 fires.
    //         const wrongParticipant = h.peers[2].address;
    //         h.tamper.stubConstructDispute(1, async (dispute) => {
    //             const localDiamond = h.getLocalDiamond(1);
    //             const [hasBlock, latestBlock] =
    //                 await localDiamond.getLatestBlockFromStateProof(
    //                     dispute.input.stateProof
    //                 );
    //             const expectedHeight = hasBlock
    //                 ? Number(latestBlock.transaction.header.transactionCnt) + 1
    //                 : 0;
    //             dispute.input.timeout.participant = wrongParticipant;
    //             dispute.input.timeout.blockHeight = expectedHeight + 1;
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

    //         await submitFaultyBlock(h, 1);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType:
    //                 DisputeFraudProofType.TimeoutNotLinkedToLatestState
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 1 });
    //         await h.assert.sync.forkChangedWait();
    //     });

    //     it("should kill dispute and store TimeoutParticipantNotNext when timeout.participant is not the next peer to write", async function () {
    //         const h = TestSession.getHarness();
    //         await h.scenario.preDisputeSetup();

    //         // Stub peer 0's dispute construction: set timeout.participant to
    //         // peer[1].address (wrong next writer) with blockHeight = 2.
    //         h.tamper.stubConstructDispute(0, async (dispute) => {
    //             dispute.input.timeout.participant = h.peers[1].address;
    //             dispute.input.timeout.blockHeight = 2;
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

    //         await submitFaultyBlock(h, 0);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType:
    //                 DisputeFraudProofType.TimeoutParticipantNotNext
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 0 });
    //         await h.assert.sync.forkChangedWait();
    //     });

    //     it("should kill dispute and store TimeoutTooEarly when timeout dispute is posted before the timeout wait period has elapsed", async function () {
    //         const h = TestSession.getHarness();
    //         // preDisputeSetup uses timeoutSetup (evidenceTime: 3 seconds)
    //         await h.scenario.preDisputeSetup();
    //         h.event.resetEventSpies();

    //         const nextPeer = await h.query.getNextPeerToWrite();
    //         const forkId = h.activeForkId!;
    //         const latestBlock = h
    //             .getPeer(0)
    //             .stateManager.storage.blocks.getLatestBlock(forkId);
    //         const timeoutBlockHeight = latestBlock
    //             ? latestBlock.height + 1
    //             : 0;

    //         // Stub peer 1's dispute construction: set a correct participant and
    //         // blockHeight but zero minTimeStamp so it submits immediately (before
    //         // evidenceTime elapses) → Phase 3F-3: TimeoutTooEarly.
    //         h.tamper.stubConstructDispute(1, async (dispute) => {
    //             dispute.input.timeout.participant = nextPeer.address;
    //             dispute.input.timeout.blockHeight = timeoutBlockHeight;
    //             dispute.input.timeout.minTimeStamp = 0;
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

    //         await submitFaultyBlock(h, 1);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 1 });
    //         await h.assert.sync.forkChangedWait();
    //     });

    //     it.skip("should kill dispute and store TimeoutThreshold when all participants have already signed the block claimed as timed out", async function () {
    //         // TODO: Requires the state proof to go to block N while block N+1 is
    //         // already fully signed. Needs a harness helper for state-proof truncation
    //         // that consistently re-hashes derived fields (3A, 3B).
    //     });

    //     it.skip("should kill dispute and store TimeoutCalldataPosted when the block at timeout.blockHeight has been posted on-chain as calldata", async function () {
    //         // TODO: Requires posting block calldata on-chain first, then waiting
    //         // evidenceTime (to pass 3F-3) before submitting a tampered timeout dispute.
    //     });
    // });

    // describe("Invalid Output State", function () {
    //     it("should kill dispute and store DisputeInvalidOutputState when outputSnapshotDataHash is corrupted", async function () {
    //         const h = TestSession.getHarness();
    //         await h.scenario.preDisputeSetup();

    //         // Stub peer 1's dispute construction to corrupt outputSnapshotDataHash.
    //         // All input fields remain intact so phases 3A–3F pass unchanged.
    //         h.tamper.stubConstructDispute(1, async (dispute) => {
    //             dispute.outputSnapshotDataHash = hash("0x42");
    //         });
    //         h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

    //         await submitFaultyBlock(h, 1);

    //         await h.event.waitForAllPeers("onDisputeKilled", 1, {
    //             mode: "atLeast"
    //         });
    //         await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
    //             disputeFraudProofType:
    //                 DisputeFraudProofType.DisputeInvalidOutputState
    //         });
    //         await h.dispute.resolveDisputeWait({ maliciousPeerIndex: 1 });
    //         await h.assert.sync.forkChangedWait();
    //     });
    // });
});
