// @spec-test-coverage-ignore: state-proof staging shared by dispute audit tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { Codec, hash as keccakHash, Type } from "@/utils";
import { buildAndEncodeBlock, hash as randomHash } from "@test/factory";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";

/** The block at `height` stored on `peerIndex`, with its confirmations, the snapshot it commits and that snapshot's state. */
export async function storedProofBlock(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    height: number
) {
    const query = h.control(h.getPeer(peerIndex)).query;
    const bundle = (await query.getBlockByHeight(forkId, height).request())!;
    const encoded = (await query
        .getStateSnapshotStructByHash(bundle.stateSnapshotHash as Hash)
        .request())!;
    const snapshot = Codec.decode(encoded.encodedSnapshot, Type.StateSnapshot);
    return {
        confirmation: Codec.decode(
            bundle.encodedBlockConfirmation,
            Type.BlockConfirmation
        ),
        snapshot,
        state: await storedState(h, peerIndex, snapshot)
    };
}

/** The state `snapshot` commits, as stored on the peer. */
export async function storedState(
    h: MathPeerTestHarness,
    peerIndex: number,
    snapshot: StateSnapshotStruct
): Promise<Bytes> {
    const state = await h
        .control(h.getPeer(peerIndex))
        .query.getStateMachineState(
            snapshot.snapshotData.stateMachineStateHash as Hash
        )
        .request();
    if (state === null) throw new Error("the snapshot's state is not stored");
    return state as Bytes;
}

/** `snapshot` with a later timestamp: same data, a different hash. */
export function forgedTimestamp(
    snapshot: StateSnapshotStruct
): StateSnapshotStruct {
    const timestamp = Number(snapshot.timestamp) + 1;
    return StateSnapshot.from({ ...snapshot, timestamp }).toStruct();
}

/**
 * `dispute` re-pointed at `milestones` with matching auditing data posted
 * alongside. `finalizedState` is the state of the snapshot the chain's walk
 * ends at (verifyStateProof binds it); omitted, the original data's is kept.
 */
export function postedProof(
    dispute: DisputeStruct,
    auditingData: DisputeAuditingDataStruct,
    proof: {
        milestones: BlockConfirmationStruct[][];
        milestoneSnapshots: StateSnapshotStruct[];
        latestStateSnapshot: StateSnapshotStruct;
        finalizedState?: Bytes;
    }
) {
    const data: DisputeAuditingDataStruct = {
        ...auditingData,
        milestoneSnapshots: proof.milestoneSnapshots,
        latestStateSnapshot: proof.latestStateSnapshot,
        latestFinalizedStateStateMachineState:
            proof.finalizedState ??
            auditingData.latestFinalizedStateStateMachineState
    };
    const posted: DisputeStruct = {
        ...omittedProof(dispute, proof.milestones),
        postedAuditingData: true
    };
    posted.input.latestStateSnapshotHash = StateSnapshot.from(
        proof.latestStateSnapshot
    ).hash;
    posted.input.disputeAuditingDataHash = keccakHash(
        Codec.encode(data, Type.DisputeAuditingData)
    );
    return { dispute: posted, auditingData: data };
}

/**
 * `posted` with the finalized state an honest disputer posts: the state,
 * held by `peerIndex`, of the snapshot the chain's walk ends at. Unchanged
 * when the chain's walk rejects the proof or the peer holds no such state.
 */
export async function withChainFinalizedState(
    h: MathPeerTestHarness,
    peerIndex: number,
    posted: { dispute: DisputeStruct; auditingData: DisputeAuditingDataStruct }
) {
    const { input } = posted.dispute;
    const walk = await h
        .getPeer(peerIndex)
        .p2pInstance.stateChannelManagerContract.verifyMilestones.staticCall({
            channelId: input.channelId,
            forkId: input.forkId,
            stateProof: input.stateProof,
            genesisStateSnapshotData:
                posted.auditingData.genesisStateSnapshotData,
            milestoneSnapshots: posted.auditingData.milestoneSnapshots
        });
    const state =
        walk.valid &&
        (await h
            .control(h.getPeer(peerIndex))
            .query.getStateMachineState(
                walk.finalizedSnapshot.snapshotData
                    .stateMachineStateHash as Hash
            )
            .request());
    if (!state) return posted;
    const auditingData: DisputeAuditingDataStruct = {
        ...posted.auditingData,
        latestFinalizedStateStateMachineState: state
    };
    return {
        dispute: {
            ...posted.dispute,
            input: {
                ...input,
                disputeAuditingDataHash: keccakHash(
                    Codec.encode(auditingData, Type.DisputeAuditingData)
                )
            }
        },
        auditingData
    };
}

/** `dispute` re-pointed at `milestones` without auditing data; the latest block names the latest state. */
export function omittedProof(
    dispute: DisputeStruct,
    milestones: BlockConfirmationStruct[][]
): DisputeStruct {
    const latest = Block.fromBlockConfirmation(milestones.at(-1)!.at(-1)!);
    return {
        ...dispute,
        postedAuditingData: false,
        input: {
            ...dispute.input,
            stateProof: {
                milestones: milestones.map((blockConfirmations) => ({
                    blockConfirmations
                }))
            },
            latestStateSnapshotHash: latest.stateSnapshotHash
        }
    };
}

/** Who the chain slashes when `auditorIndex` applies `fraudProof`, simulated. */
export async function simulatedFraudProofSlashes(
    h: MathPeerTestHarness,
    auditorIndex: number,
    fraudProof: FraudProofStruct
): Promise<string[]> {
    const contract =
        h.getPeer(auditorIndex).p2pInstance.stateChannelManagerContract;
    const simulated = await contract.multicall.staticCall([
        contract.interface.encodeFunctionData("applyFraudProofs", [
            [fraudProof],
            { channelId: h.channelId }
        ]),
        contract.interface.encodeFunctionData("getOnChainSlashedParticipants", [
            h.channelId
        ])
    ]);
    const [slashed] = contract.interface.decodeFunctionResult(
        "getOnChainSlashedParticipants",
        simulated[1]
    );
    return [...slashed];
}

/**
 * `run` plus an unseen block above its tip, linked to it and signed by a
 * participant other than `leader` (default: the next writer), committing
 * `latestStateSnapshot`: no honest replay accepts its transition.
 */
export async function withForgedTip(
    h: MathPeerTestHarness,
    run: BlockConfirmationStruct[],
    latestStateSnapshot: StateSnapshotStruct,
    participantIndices: number[],
    leader?: string
) {
    const tip = Block.fromBlockConfirmation(run.at(-1)!);
    const leaderAddress =
        leader ?? (await h.query.getNextPeerToWrite()).address;
    const offenderIndex = participantIndices.find(
        (index) => h.getPeer(index).address !== leaderAddress
    )!;
    const forged = await craftProofBlock(h, {
        authorIndex: offenderIndex,
        forkId: tip.forkId,
        height: tip.height + 1,
        previousBlockHash: tip.hash,
        stateSnapshotHash: StateSnapshot.from(latestStateSnapshot).hash
    });
    return {
        run: [...run, { signedBlock: forged.signedBlock, signatures: [] }],
        forged: forged.block,
        offenderIndex
    };
}

/**
 * Peer 2 cut off after blocks 0..2, then peer 0's posted proof [[2, 3], [2, 3]]:
 * block 2 threshold-final in both milestones, block 3 the same unseen block
 * in both, forged over a wrong state.
 */
export async function postedRepeatedTailDispute(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3, { timeConfig: { chainFallbackTime: 60 } });
    await h.network.blacklistAndDisconnectPeer(2);
    await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
    const forkId = h.activeForkId!;
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const support = await storedProofBlock(h, 0, forkId, 2);
    const next = await storedProofBlock(h, 0, forkId, 3);
    const latest = forgedTimestamp(next.snapshot);
    const { run, forged, offenderIndex } = await withForgedTip(
        h,
        [support.confirmation],
        latest,
        [0, 1, 2],
        String(Block.fromBlockConfirmation(next.confirmation).author)
    );
    return {
        ...postedProof(dispute, auditingData, {
            milestones: [run, run],
            milestoneSnapshots: [support.snapshot, support.snapshot],
            latestStateSnapshot: latest,
            finalizedState: support.state
        }),
        tail: forged,
        offenderIndex
    };
}

/** Peer 0's dispute posted as one forged block above its tip, final by no threshold. */
export async function postedForgedSingleton(h: MathPeerTestHarness) {
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const tip = dispute.input.stateProof.milestones
        .at(-1)!
        .blockConfirmations.at(-1)!;
    const latest = forgedTimestamp(auditingData.latestStateSnapshot);
    const { run } = await withForgedTip(h, [tip], latest, [0, 1, 2]);
    return postedProof(dispute, auditingData, {
        milestones: [run.slice(1)],
        milestoneSnapshots: [latest],
        latestStateSnapshot: latest
    });
}

/** The chain's state-proof start height of the peer's fork (0: the genesis). */
function chainStartHeight(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<number> {
    return h.execOnHost(h.getPeer(peerIndex), async (sm) => {
        const { canUseOnChainSnapshot, onChainSnapshot } =
            await sm.stateChannelManagerContract.getAnchorSnapshot(
                sm.channelId,
                sm.forkId
            );
        return canUseOnChainSnapshot ? Number(onChainSnapshot.blockHeight) : 0;
    });
}

/**
 * Four peers; one leaves, so its exit posts the on-chain snapshot that
 * starts the fork's proofs above height 0, and the others author three more
 * blocks past it. Every remaining peer holds the full history.
 */
export async function stageExitAnchoredFork(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    // the exit settles after an agreement window plus the snapshot
    // transaction; an idle writer slot meanwhile would open a
    // participant-timeout dispute
    const leaver = await h.transition.participantLeaveStateTransition();
    h.context.leftChannelPeerIndices = [leaver];
    const participants = [0, 1, 2, 3].filter((index) => index !== leaver);
    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [leaver],
        status: Status.SYNCED,
        waitForPeers: participants,
        excludePeerIndices: [leaver]
    });
    await h.transition.advanceState({ count: 3, waitForPeers: participants });
    const anchorHeight = await chainStartHeight(h, participants[0]);
    expect(anchorHeight, "the exit must anchor the fork").to.be.greaterThan(0);
    return { forkId: h.activeForkId!, participants, anchorHeight };
}

/**
 * Three peers; peer 2 leaves, so its exit posts a same-fork snapshot above
 * height 0 that peer 1's local diamond never applies: its proof start stays
 * the genesis.
 */
export async function stageAuditorBehindOnChainAnchor(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    const auditorIndex = 1;
    const auditor = h.control(h.getPeer(auditorIndex));
    await auditor.stub.stubHoldSnapshotUpdatedEvents().request();
    await h.transition.participantLeaveStateTransition({ leaverIndex: 2 });
    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [2],
        status: Status.SYNCED,
        waitForPeers: [0, 1],
        excludePeerIndices: [2]
    });
    await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
    // dropped, not replayed
    await auditor.stub.restoreSnapshotUpdatedEvents(false).request();
    const anchorHeight = await chainStartHeight(h, 0);
    expect(anchorHeight, "the exit must anchor the fork").to.be.greaterThan(0);
    return { auditorIndex, anchorHeight };
}

/**
 * `joiner` (synced) submits its join, so it audits as a pending participant;
 * the participants' timeout checks are suppressed first: no block seats the
 * joiner, and an idle writer slot would open a participant-timeout dispute.
 */
export async function submitPendingJoin(
    h: MathPeerTestHarness,
    joiner: TestPeer<HarnessControlRpc>,
    participants: number[]
) {
    for (const index of participants)
        await h.rpcStub.suppressTimeoutCheck(index);
    expect(await h.join.joinChannelWait({ joiner }), "join submitted").to.equal(
        true
    );
    expect(
        await h.control(joiner).query.getStatus().request(),
        "the auditor is a pending participant"
    ).to.equal(Status.PENDING_PARTICIPANT);
}

/**
 * Three peers and blocks 0-3; the auditor synced at the genesis and its
 * block work is held, then it submits its join and audits as a pending
 * participant. The join's own sync installs at most the latest state: the
 * head block and its state, not the states below it. `release` resumes its
 * block work.
 */
export async function heldGenesisPendingAuditor(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const auditor = await h.join.addSpectatorWait();
    const hold = await h.rpcStub.holdBlockWork(auditor.index, "queueDequeue");
    try {
        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true,
            waitForPeers: [0, 1, 2]
        });
        await submitPendingJoin(h, auditor, [0, 1, 2]);
    } catch (error) {
        await hold.release();
        throw error;
    }
    return { auditor, release: hold.release };
}

/**
 * A block authored and signed by `authorIndex` at `height` that links to
 * nothing (random previousBlockHash) unless `previousBlockHash` is given.
 */
export async function craftProofBlock(
    h: MathPeerTestHarness,
    options: {
        authorIndex: number;
        forkId: ForkId;
        height: number;
        previousBlockHash?: Hash;
        stateSnapshotHash?: Hash;
    }
): Promise<{ signedBlock: SignedBlockStruct; block: Block }> {
    const encodedConfirmation = await buildAndEncodeBlock(
        h.getPeer(options.authorIndex).signer,
        {
            header: {
                channelId: h.channelId,
                forkId: options.forkId,
                transactionCnt: options.height
            },
            previousBlockHash: options.previousBlockHash ?? randomHash(),
            ...(options.stateSnapshotHash
                ? { stateSnapshotHash: options.stateSnapshotHash }
                : {})
        }
    );
    const { signedBlock } = Codec.decode(
        encodedConfirmation,
        Type.BlockConfirmation
    );
    return { signedBlock, block: Block.fromSignedBlock(signedBlock) };
}

/**
 * A forged block one below the on-chain start (`anchorHeight`), signed by a
 * participant that is not the real author of that height and linked to
 * nothing, committing a forged copy of the real block's snapshot. As a
 * one-block milestone it is wholly below the walk start.
 */
export async function forgedMilestoneBelowAnchor(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        anchorHeight: number;
        participants: number[];
    }
) {
    const height = options.anchorHeight - 1;
    const real = await storedProofBlock(
        h,
        options.participants[0],
        options.forkId,
        height
    );
    const realAuthor = Block.fromBlockConfirmation(real.confirmation).author;
    const authorIndex = options.participants.find(
        (index) => h.getPeer(index).address !== realAuthor
    )!;
    const snapshot = forgedTimestamp(real.snapshot);
    const forged = await craftProofBlock(h, {
        authorIndex,
        forkId: options.forkId,
        height,
        stateSnapshotHash: StateSnapshot.from(snapshot).hash
    });
    return {
        confirmation: {
            signedBlock: forged.signedBlock,
            signatures: []
        } as BlockConfirmationStruct,
        block: forged.block,
        snapshot
    };
}

/** `confirmation`'s block with its header timestamp set to `timestamp`, signed by its author alone. */
async function restamped(
    h: MathPeerTestHarness,
    confirmation: BlockConfirmationStruct,
    timestamp: number
): Promise<BlockConfirmationStruct> {
    const decoded = Codec.decode(
        confirmation.signedBlock.encodedBlock,
        Type.Block
    );
    const encodedBlock = Codec.encode(
        {
            ...decoded,
            transaction: {
                ...decoded.transaction,
                header: {
                    ...decoded.transaction.header,
                    timestamp: BigInt(timestamp)
                }
            }
        },
        Type.Block
    ) as string;
    const author = String(Block.fromBlockConfirmation(confirmation).author);
    const signature = await h.peers
        .find((peer) => peer.address === author)!
        .signer.signMessage(
            Buffer.from(keccakHash(encodedBlock).slice(2), "hex")
        );
    return { signedBlock: { encodedBlock, signature }, signatures: [] };
}

/** Far enough past the genesis that no time configuration admits it. */
const FAR_FUTURE_SECONDS = 100_000;

/**
 * Four peers, peer 2 cut off before block 0, so the auditor (peer 2, a
 * participant) holds only the genesis. Peer 0's dispute posted as one
 * unfinal block 0: the real block 0, from its real author and linked to the
 * genesis, but re-signed with a timestamp far past the genesis.
 */
export async function stageFarFutureGenesisTail(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetupDisconnectedPeer();
    const auditor = h.getPeer(2);
    const forkId = h.activeForkId!;
    const first = await storedProofBlock(h, 0, forkId, 0);
    const tail = await restamped(
        h,
        first.confirmation,
        Block.fromBlockConfirmation(first.confirmation).timestamp +
            FAR_FUTURE_SECONDS
    );
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    return {
        auditor,
        ...postedProof(dispute, auditingData, {
            milestones: [[tail]],
            milestoneSnapshots: [first.snapshot],
            latestStateSnapshot: first.snapshot
        })
    };
}

/**
 * `stageExitAnchoredFork`, then a new peer syncs and submits its join, so
 * it audits as a pending participant: it synced past the on-chain start
 * without the block at the start height, and holds the blocks above it
 * with only the installed state. Timeout checks are suppressed: an idle
 * writer slot would open a participant-timeout dispute.
 */
export async function stagePendingJoinerPastStart(h: MathPeerTestHarness) {
    const staged = await stageExitAnchoredFork(h);
    for (const index of staged.participants)
        await h.rpcStub.suppressTimeoutCheck(index);
    const joiner = await h.join.addSpectatorWait();
    await submitPendingJoin(h, joiner, staged.participants);
    const held = await h.execOnHost(
        h.getPeer(joiner.index),
        async (sm, args) => {
            const head = sm.storage.blocks.getNextBlockHeight(args.forkId) - 1;
            const block = sm.storage.blocks.getBlock(args.forkId, head);
            const snapshot =
                block &&
                sm.storage.stateSnapshots.getStateSnapshotByHash(
                    block.stateSnapshotHash
                );
            return {
                atStart: !!sm.storage.blocks.getBlock(args.forkId, args.height),
                head,
                hasHeadState:
                    !!snapshot &&
                    sm.storage.stateMachineStates.getStateMachineState(
                        snapshot.stateMachineStateHash
                    ) !== undefined
            };
        },
        { forkId: staged.forkId, height: staged.anchorHeight }
    );
    expect(held.atStart, "no block at the start height").to.equal(false);
    expect(held.head, "blocks above the start").to.be.greaterThan(
        staged.anchorHeight
    );
    return {
        ...staged,
        joiner,
        joinerHead: held.head,
        hasHeadState: held.hasHeadState
    };
}

/**
 * Peer 0's dispute re-pointed, with auditing data, at one milestone wholly
 * below every remaining peer's local final point: an unlinked block at the
 * start height that commits the start, then the next author's block linked
 * to it over a forged latest snapshot.
 */
export async function postedForgedRunOnChainStart(
    h: MathPeerTestHarness,
    options: { forkId: ForkId; anchorHeight: number; participants: number[] }
) {
    const { forkId, anchorHeight, participants } = options;
    const [disputer] = participants;
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(disputer);
    const real = await storedProofBlock(h, disputer, forkId, anchorHeight);
    const next = await storedProofBlock(h, disputer, forkId, anchorHeight + 1);
    const realAuthor = Block.fromBlockConfirmation(real.confirmation).author;
    const start = await craftProofBlock(h, {
        authorIndex:
            participants.find(
                (index) => h.getPeer(index).address === realAuthor
            ) ?? disputer,
        forkId,
        height: anchorHeight,
        stateSnapshotHash: StateSnapshot.from(real.snapshot).hash
    });
    const latest = forgedTimestamp(next.snapshot);
    const { run } = await withForgedTip(
        h,
        [{ signedBlock: start.signedBlock, signatures: [] }],
        latest,
        participants,
        String(Block.fromBlockConfirmation(next.confirmation).author)
    );
    return postedProof(dispute, auditingData, {
        milestones: [run],
        milestoneSnapshots: [real.snapshot],
        latestStateSnapshot: latest,
        finalizedState: real.state
    });
}

/**
 * Four peers, peer 2 cut off before block 0 (no block final by everyone).
 * Peer 0's constructed dispute, its last block re-authored by an outsider
 * wallet. Peer 2 holds only the genesis: it replays the whole run and holds
 * no resulting snapshot of the outsider block.
 */
export async function stageOutsiderAuthoredTail(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetupDisconnectedPeer();
    const auditor = h.getPeer(2);
    await h.tamper.stubConstructDispute(
        0,
        async (dispute, sm) => {
            await sm.p2pManager.localRpc.dispute.rewriteLastMilestoneBlockAuthorAsOutsider(
                dispute
            );
        },
        { markMalicious: false }
    );
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const run = dispute.input.stateProof.milestones.at(-1)!.blockConfirmations;
    return {
        auditor,
        dispute,
        auditingData,
        outsiderBlockIndex: run.length - 1
    };
}

/**
 * Three participants author blocks 0-4 and peer 0 posts the latest snapshot
 * (the chain anchor). Participant 2 is then cut off: it holds the anchor
 * block and its state, and its threshold point is the anchor, while peers 0
 * and 1 author one more
 * block (one in flight may still reach it). Timeout checks are suppressed.
 * Returns the auditor (participant 2), its head when cut off and the anchor
 * height.
 */
export async function stageParticipantCutOffAtChainAnchor(
    h: MathPeerTestHarness
) {
    await h.lifecycle.start(3, 3);
    await h.transition.advanceState({
        count: 2,
        waitForFinalization: true,
        waitForPeers: [0, 1, 2]
    });
    const forkId = h.activeForkId!;
    const posted = await h.transition.postSnapshotWait({
        peerIndex: 0,
        forkId: String(forkId)
    });
    const auditor = h.getPeer(2);
    await h.network.blacklistAndDisconnectPeer(auditor.index);
    const head = (await h
        .control(auditor)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
    for (const index of [0, 1]) await h.rpcStub.suppressTimeoutCheck(index);
    return { forkId, auditor, head, anchorHeight: posted!.blockHeight };
}

/**
 * Three peers and blocks 0-3; the auditor is a pending participant
 * (`heldGenesisPendingAuditor`) without the blocks above the genesis. Peer
 * 0's dispute posted as the threshold-final block 2 and an unseen block 3
 * linked to it, signed by a participant that is not the real author of
 * block 3. The posted finalized state is block 2's. `release` resumes the
 * auditor's block work.
 */
export async function stagePendingAuditorForgedTail(h: MathPeerTestHarness) {
    const { auditor, release } = await heldGenesisPendingAuditor(h);
    const forkId = h.activeForkId!;
    const support = await storedProofBlock(h, 0, forkId, 2);
    const real = await storedProofBlock(h, 0, forkId, 3);
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const latest = forgedTimestamp(real.snapshot);
    const { run, offenderIndex } = await withForgedTip(
        h,
        [support.confirmation],
        latest,
        [0, 1, 2],
        String(Block.fromBlockConfirmation(real.confirmation).author)
    );
    return {
        auditor,
        release,
        offenderIndex,
        ...postedProof(dispute, auditingData, {
            milestones: [run],
            milestoneSnapshots: [support.snapshot],
            latestStateSnapshot: latest,
            finalizedState: support.state
        })
    };
}

/**
 * `heldGenesisPendingAuditor`, then the participants author one more block
 * that `admitted` includes the auditor's join in, or omits it from. The
 * auditor never sees that block live: it is the unfinal tail of peer 0's
 * self-removal dispute, which the auditor then audits. For an omitted join
 * the auditor's force-join counting window is open first, so a replayed
 * block could count toward it. `release` resumes the auditor's block work.
 */
export async function stagePendingAuditorReplay(
    h: MathPeerTestHarness,
    admitted: boolean
) {
    const { auditor, release } = await heldGenesisPendingAuditor(h);
    if (!admitted)
        for (const index of [0, 1, 2])
            await h.byzantine.stubPendingInboundInclusion(index);
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 2] });
    const forkId = h.activeForkId!;
    const tail = await storedProofBlock(
        h,
        0,
        forkId,
        (await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request())!
    );
    expect(
        tail.snapshot.snapshotData.participants.includes(auditor.address),
        "the tail block's participants"
    ).to.equal(admitted);
    if (!admitted) {
        const control = h.control(auditor);
        let startsAt: number | null = null;
        await waitFor(async () => {
            startsAt = await h.execOnHost(
                h.getPeer(auditor.index),
                async (sm) => sm.storage.forceJoin.getCountingStartsAt() ?? null
            );
            return (
                startsAt !== null &&
                (await control.query.getClockTimeInSeconds().request()) >=
                    startsAt
            );
        }, h.event.protocolEventTimeoutMs());
    }
    await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    return { auditor, release, dispute, auditingData };
}

/** The auditor's status and force-join counting height. */
export async function readPendingAuditorMembership(
    h: MathPeerTestHarness,
    auditor: TestPeer<HarnessControlRpc>
) {
    return await h.execOnHost(h.getPeer(auditor.index), async (sm) => ({
        status: sm.status,
        countingFromHeight: sm.storage.forceJoin.getCountingFromHeight() ?? null
    }));
}
