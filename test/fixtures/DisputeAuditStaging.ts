// @spec-test-coverage-ignore: dispute audit staging shared by the plan-35 auditor unit tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { timeoutWaitTime } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { Address, ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { buildAndEncodeBlock } from "@test/factory";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type {
    RecordedBestEffortEstimate,
    RecordedDisputeSubmission,
    RecordedFraudProofApply,
    RefusedUploadKind
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { stageOutboundAroundAnchor } from "@test/fixtures/HistoricSyncStaging";
import { syncSpectatorOnServedPayload } from "@test/fixtures/MilestoneSyncStaging";
import { stageMirrorMissingConsumedTopUp } from "@test/fixtures/MirrorDivergenceStaging";
import {
    addFreshSpectator,
    readLocalFinalizedHeight,
    joinAsPendingParticipant,
    readWindowReduction,
    waitForChainInboundHead
} from "@test/fixtures/OlderDisputeStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { stageFinalityFromNextBlock } from "@test/fixtures/ProofOwnerStaging";
import type { DisputeTamper } from "@test/harness/actions/DisputeTamperingActions";
import type {
    DisputeSubmissionRecording,
    EvidenceComparisonRecording
} from "@test/harness/actions/rpcStubActions";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeConflictsWithFinalStateStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";
import { MaxUint256, ZeroAddress } from "ethers";

/**
 * Height of `peerIndex`'s latest locally finalized state (the first audit
 * tier's start), or null when it has none.
 */
export async function localFinalizedHeight(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<number | null> {
    return readLocalFinalizedHeight(h, peerIndex, h.activeForkId!);
}

/** Whether `peerIndex`'s local diamond holds a same-fork non-genesis anchor. */
export async function hasLocalAnchor(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<boolean> {
    return await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const { canUseOnChainSnapshot } =
                await sm.diamondStateMachine.localDiamondContract.getAnchorSnapshot.staticCall(
                    sm.channelId,
                    args.forkId
                );
            return canUseOnChainSnapshot;
        },
        { forkId: h.activeForkId! }
    );
}

/**
 * Peer 0 posts a snapshot of its latest finalized state while every peer in
 * `laggingIndices` holds its StateSnapshotUpdated events: their local
 * diamonds keep the older anchor while the chain and the other mirrors move.
 * Returns the posted snapshot.
 */
export async function postSnapshotPastLaggingMirrors(
    h: MathPeerTestHarness,
    laggingIndices: number[]
): Promise<StateSnapshot> {
    for (const index of laggingIndices)
        await h
            .control(h.getPeer(index))
            .stub.stubHoldSnapshotUpdatedEvents()
            .request();
    const posted = await h.transition.postSnapshot({ peerIndex: 0 });
    if (!posted) throw new Error("No newer finalized snapshot to post");
    const current = h.peers.filter(
        (peer) => !laggingIndices.includes(peer.index)
    );
    const timeoutMs = h.event.protocolEventTimeoutMs({
        withFirstBlockGrace: true
    });
    await h.eventCountsBarrier.waitFor(
        async () =>
            (await h.query.getOnChainSnapshotHash()) === posted.hash &&
            (
                await Promise.all(
                    current.map((peer) => h.query.getLocalStateSnapshot(peer))
                )
            ).every((snapshot) => snapshot.hash === posted.hash),
        {
            timeoutMs,
            timeoutMessage: `the chain and the current mirrors did not reach snapshot ${posted.hash} within ${timeoutMs}ms`
        }
    );
    for (const index of laggingIndices)
        expect(
            await hasLocalAnchor(h, index),
            `peer ${index}'s mirror must keep the genesis anchor`
        ).to.equal(false);
    return posted;
}

/** The block confirmation `peerIndex` stores at `height` of the active fork. */
export async function blockConfirmationAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
): Promise<BlockConfirmationStruct> {
    const bundle = await h
        .control(h.getPeer(peerIndex))
        .query.getBlockByHeight(h.activeForkId!, height)
        .request();
    if (!bundle) throw new Error(`peer ${peerIndex} has no block ${height}`);
    return Codec.decode(
        bundle.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
}

/**
 * `confirmation`'s block with its previous block hash replaced, re-signed by
 * its own author and carrying no other signature.
 */
export async function relinkBlock(
    h: MathPeerTestHarness,
    confirmation: BlockConfirmationStruct,
    previousBlockHash: Hash
): Promise<BlockConfirmationStruct> {
    const original = Block.fromBlockConfirmation(confirmation);
    const author = h.peers.find((peer) => peer.address === original.author);
    if (!author) throw new Error(`No harness peer authored ${original.hash}`);
    const relinked = await Block.fromBlockStruct(
        { ...original.blockStruct, previousBlockHash },
        author.signer
    );
    return relinked.blockConfirmationStruct;
}

/**
 * An authentic block at `height` linked to `previousBlockHash`, authored by a
 * participant other than `notAuthor`, whose committed snapshot is no state
 * transition result: replaying it fails.
 */
export async function craftInvalidLinkedBlock(
    h: MathPeerTestHarness,
    options: { height: number; previousBlockHash: Hash; notAuthor: Address }
): Promise<BlockConfirmationStruct> {
    const author = h.peers.find((peer) => peer.address !== options.notAuthor);
    if (!author) throw new Error("No other harness peer can author");
    const encoded = await buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId: h.activeForkId!,
            transactionCnt: options.height,
            participant: author.address
        },
        previousBlockHash: options.previousBlockHash
    });
    return Codec.decode(encoded, Type.BlockConfirmation);
}

/**
 * Peer 0's blocks `fromHeight`..`toHeight` as one linked run, with the block
 * at `invalidHeight` (>= 1) replaced by {@link craftInvalidLinkedBlock} and
 * every later block relinked onto it: the run's later blocks keep their
 * committed snapshots, so its last block still commits the real state.
 */
export async function runWithInvalidBlock(
    h: MathPeerTestHarness,
    options: { fromHeight: number; invalidHeight: number; toHeight: number }
): Promise<BlockConfirmationStruct[]> {
    const run: BlockConfirmationStruct[] = [];
    for (
        let height = options.fromHeight;
        height < options.invalidHeight;
        height++
    )
        run.push(await blockConfirmationAt(h, 0, height));
    const previous = Block.fromBlockConfirmation(
        await blockConfirmationAt(h, 0, options.invalidHeight - 1)
    );
    const replaced = Block.fromBlockConfirmation(
        await blockConfirmationAt(h, 0, options.invalidHeight)
    );
    let last = await craftInvalidLinkedBlock(h, {
        height: options.invalidHeight,
        previousBlockHash: previous.hash,
        notAuthor: replaced.author
    });
    run.push(last);
    for (
        let height = options.invalidHeight + 1;
        height <= options.toHeight;
        height++
    ) {
        last = await relinkBlock(
            h,
            await blockConfirmationAt(h, 0, height),
            Block.fromBlockConfirmation(last).hash
        );
        run.push(last);
    }
    return run;
}

/** An invalid block linked after the last block of `run`. */
export async function craftInvalidBlockAfter(
    h: MathPeerTestHarness,
    run: BlockConfirmationStruct[]
): Promise<BlockConfirmationStruct> {
    const last = Block.fromBlockConfirmation(run.at(-1)!);
    return await craftInvalidLinkedBlock(h, {
        height: last.height + 1,
        previousBlockHash: last.hash,
        notAuthor: last.author
    });
}

/**
 * Give `dispute` the omitted-data proof `milestones` and name the state its
 * last block commits as the dispute's latest state.
 */
export function replaceStateProof(
    dispute: DisputeStruct,
    milestones: MilestoneProofStruct[]
): void {
    dispute.input.stateProof = { milestones };
    const last = milestones.at(-1)?.blockConfirmations.at(-1);
    if (last)
        dispute.input.latestStateSnapshotHash =
            Block.fromBlockConfirmation(last).stateSnapshotHash;
    dispute.postedAuditingData = false;
}

/** Hash of the snapshot `peerIndex` stores at `height` of the active fork. */
export async function snapshotAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
): Promise<StateSnapshot> {
    const result = await h
        .control(h.getPeer(peerIndex))
        .query.getStateSnapshotStructAt(h.activeForkId!, height)
        .request();
    if (!result) throw new Error(`peer ${peerIndex} has no snapshot ${height}`);
    return StateSnapshot.from(
        Codec.decode(result.encodedSnapshot, Type.StateSnapshot)
    );
}

/** Whether `peerIndex` holds the full application state of `snapshot`. */
export async function holdsState(
    h: MathPeerTestHarness,
    peerIndex: number,
    snapshot: StateSnapshot
): Promise<boolean> {
    return (
        (await h
            .control(h.getPeer(peerIndex))
            .query.getStateMachineState(snapshot.stateMachineStateHash as Hash)
            .request()) !== null
    );
}

/**
 * The highest height of the active fork whose application state
 * `peerIndex` does not hold (peer 0's snapshots name the states), or -1.
 */
export async function highestMissingStateHeight(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<number> {
    const latest = await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(h.activeForkId!)
        .request();
    let missing = -1;
    for (let height = 0; height <= (latest ?? -1); height++)
        if (!(await holdsState(h, peerIndex, await snapshotAt(h, 0, height))))
            missing = height;
    return missing;
}

/**
 * `peerIndex`'s own proof through `height` (built by AgreementManager) with
 * every confirmation signature removed: each milestone keeps only its
 * authors' signatures, so no threshold hop of it is proven.
 */
export async function unsignedOwnMilestonesThrough(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
): Promise<MilestoneProofStruct[]> {
    const { encodedStateProof } = await h
        .control(h.getPeer(peerIndex))
        .dispute.buildOwnAuditingData(h.activeForkId!, height)
        .request();
    return Codec.decode(encodedStateProof, Type.StateProof).milestones.map(
        (milestone) => ({
            blockConfirmations: milestone.blockConfirmations.map(
                (confirmation) => ({ ...confirmation, signatures: [] })
            )
        })
    );
}

/**
 * Three peers with four final blocks. Peer 0 posts the latest one as the
 * on-chain anchor while peer 2 holds its StateSnapshotUpdated events, so
 * peer 1's mirror is current and peer 2's lags at the genesis.
 */
export async function stageAnchorBehindLaggingMirror(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    await h.transition.advanceState({ count: 1, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    const anchor = await postSnapshotPastLaggingMirrors(h, [2]);
    const latestHeight = await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(h.activeForkId!)
        .request();
    expect(anchor.blockHeight, "the anchor is the latest block").to.equal(
        latestHeight
    );
    return {
        anchorHeight: anchor.blockHeight,
        currentIndex: 1,
        laggingIndex: 2
    };
}

/**
 * Four peers, blocks 0 and 1 final. The author of block 1 is cut off (its
 * view stays frozen at block 1) while the others author two more blocks that
 * cannot become final without it. Timeout checks are suppressed on every
 * peer. A live peer's dispute then carries a proof whose last milestone is
 * the final block 1 and the unfinalized tail 2, 3; it is returned with its
 * auditing data marked posted.
 */
export async function stageFrozenViewBehindDisputeTail(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({ peerCount: 4, transitionCount: 2 });
    const forkId: ForkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const latest = await h
        .control(h.getPeer(0))
        .query.getLatestBlockInfo(forkId)
        .request();
    // the latest author writes again only after every other peer
    const frozen = h.peers.find((peer) => peer.address === latest!.author)!;
    const frozenHeight = (await h
        .control(frozen)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    await h.network.blacklistAndDisconnectPeer(frozen.index);
    const live = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== frozen.index);
    await h.transition.advanceState({ count: 2, waitForPeers: live });
    const disputerIndex = live[0]!;
    const constructed = await h.dispute.fetchConstructedDispute(disputerIndex);
    // the final first block allows omitting the data; posting is never wrong
    // and lets the frozen peer be handed the committed data
    constructed.dispute.postedAuditingData = true;
    return {
        forkId,
        frozenIndex: frozen.index,
        frozenHeight,
        disputerIndex,
        live,
        ...constructed
    };
}

/** A dispute with no reason (no timeout, slash or self-removal) is invalid. */
export const stripDisputeReasons: DisputeTamper = (dispute) => {
    dispute.input.timeout.participant = ZeroAddress;
    dispute.input.onChainSlashes = [];
    dispute.input.selfRemoval = false;
    dispute.input.requireExistingDisputeWindow = false;
};

/**
 * Four peers; peer 1 uploads a dispute that states no reason, so every
 * honest auditor finds it invalid. Peers 1-3 stay out of the kill race:
 * peer 0 is the auditor under test, and its dispute uploads are recorded and
 * forwarded (`hold` parks each at its send). Timeout checks are suppressed.
 */
export async function stageReasonlessInitialDispute(
    h: MathPeerTestHarness,
    options: { hold: boolean }
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const spammer = h.getPeer(1);
    for (const index of [1, 2, 3]) await h.rpcStub.suppressDisputeKill(index);
    const submissions = await h.rpcStub.recordDisputeSubmissions(0, {
        hold: options.hold,
        forward: true
    });
    await h.tamper.postTamperedDispute(spammer.index, stripDisputeReasons);
    return {
        spammer,
        submissions,
        /** Until a recorded upload was mined or reverted. */
        waitUntilSettled: () =>
            waitFor(
                async () =>
                    (await submissions.submissions()).some(
                        (submission) =>
                            submission.waited || submission.revert !== null
                    ),
                h.event.protocolEventTimeoutMs()
            )
    };
}

/**
 * Four peers with a long evidence period; peer 1 uploads a reasonless
 * dispute. Peer 0's kill and replacement land in one multicall, so the window
 * is never empty again and no peer replaces the dispute. Peer 2 stored its
 * own counter, but its kill was skipped; its dispute uploads are now recorded
 * and forwarded with a best-effort multicall's upload rewritten as
 * `refuseUpload` says, and its lone kills are recorded. Peers 1 and 3 stay
 * out of the kill race; timeout checks and reductions are held.
 */
export async function stageRefusedKillAndDispute(
    h: MathPeerTestHarness,
    refuseUpload: RefusedUploadKind
) {
    // long enough that peer 2's upload is still inside the evidence period
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 30 }
    });
    const forkId = h.activeForkId!;
    for (const peer of h.peers) {
        await h.rpcStub.suppressTimeoutCheck(peer.index);
        await h.rpcStub.holdReductionRace(peer.index);
    }
    const spammer = h.getPeer(1);
    const slow = h.getPeer(2);
    for (const index of [1, 3]) await h.rpcStub.suppressDisputeKill(index);
    const skippedKill = await h.rpcStub.suppressDisputeKill(slow.index);
    const first = await h.rpcStub.recordDisputeSubmissions(0, {
        forward: true
    });
    await h.tamper.postTamperedDispute(spammer.index, stripDisputeReasons);
    await skippedKill.waitUntilSkipped();
    await waitFor(
        async () =>
            (await first.submissions()).some((submission) => submission.waited),
        h.event.protocolEventTimeoutMs()
    );
    const [landed] = await first.submissions();
    expect(landed.revert, "peer 0's replacement landed").to.equal(null);
    await skippedKill.restore();
    const submissions = await h.rpcStub.recordDisputeSubmissions(slow.index, {
        forward: true,
        refuseUpload
    });
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(slow.index);
    return { forkId, spammer, slow, submissions, applies };
}

/**
 * Four peers with a long evidence period; peer 1 uploads a reasonless
 * dispute. Peer 0's kill and replacement land late in the kill period, after
 * which the evidence period closes; peer 2, a slow auditor whose dispute
 * construction was held, then builds its kill and dispute. Peers 1 and 3
 * stay out of the kill race; timeout checks and reductions are held. Peer
 * 2's dispute uploads (forwarded, a best-effort upload rewritten as
 * `refuseUpload` says) and lone kills are recorded; with `minimumEstimate`
 * its best-effort multicall estimate is answered with the least gas
 * (`bestEffortEstimates` reads that probe). Returns once peer 2's
 * construction is released.
 */
export type SlowAuditorPastEvidencePeriod = {
    forkId: ForkId;
    slow: TestPeer<HarnessControlRpc, MathStateMachine>;
    /** Lone kills the slow auditor sent. */
    slowKills: { applies: () => Promise<RecordedFraudProofApply[]> };
    slowSubmissions: DisputeSubmissionRecording;
    /** The minimum-estimate probe's records, when installed. */
    bestEffortEstimates?: () => Promise<RecordedBestEffortEstimate[]>;
};

export async function stageSlowAuditorPastEvidencePeriod(
    h: MathPeerTestHarness,
    options: { minimumEstimate?: boolean; refuseUpload?: RefusedUploadKind }
): Promise<SlowAuditorPastEvidencePeriod> {
    const evidenceTime = 14;
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime }
    });
    const forkId = h.activeForkId!;
    for (const peer of h.peers) {
        await h.rpcStub.suppressTimeoutCheck(peer.index);
        await h.rpcStub.holdReductionRace(peer.index);
    }
    const spammer = h.getPeer(1);
    const slow = h.getPeer(2);
    for (const index of [1, 3]) await h.rpcStub.suppressDisputeKill(index);
    const first = await h.rpcStub.recordDisputeSubmissions(0, {
        hold: true,
        forward: true
    });
    const slowKills = await h.rpcStub.recordDisputeFraudProofApplies(
        slow.index
    );
    const slowSubmissions = await h.rpcStub.recordDisputeSubmissions(
        slow.index,
        { forward: true, refuseUpload: options.refuseUpload }
    );
    const estimates = options.minimumEstimate
        ? await h.rpcStub.answerMinimumBestEffortEstimate(slow.index)
        : undefined;
    const slowConstruction = await h.rpcStub.holdConstructDisputeAtStateProof(
        slow.index,
        forkId
    );

    await h.tamper.postTamperedDispute(spammer.index, stripDisputeReasons);
    await first.waitUntilHeld();
    // the slow auditor found the dispute invalid and builds its own
    await slowConstruction.waitUntilParked();
    const created = Number(
        await h.channelManager.getDisputeWindowCreationTimestamp(
            h.channelId,
            forkId
        )
    );

    // the first kill and replacement land late in the kill period
    await h.event.waitUntilTimestamp(created + evidenceTime - 6);
    await first.release();
    await waitFor(
        async () =>
            (await first.submissions()).some(
                (submission) => submission.waited || submission.revert !== null
            ),
        h.event.protocolEventTimeoutMs()
    );
    const [landed] = await first.submissions();
    expect(landed.revert).to.equal(null);
    await h.assert.dispute.slashedOnChain(spammer.address);

    // the evidence period is over; the replacement's kill period is not
    await h.event.waitUntilTimestamp(created + evidenceTime + 1);
    await slowConstruction.release();
    return {
        forkId,
        slow,
        slowKills,
        slowSubmissions,
        bestEffortEstimates: estimates?.estimates
    };
}

/**
 * The slow auditor of `stageSlowAuditorPastEvidencePeriod` sent one
 * best-effort multicall, kill first, that was mined; its refused upload was
 * the lost-race no-op: its dispute did not land, its marker rolled back, no
 * kill was sent alone, and its event pipeline survived. Returns the record.
 */
export async function expectSlowAuditorLostRaceNoOp(
    h: MathPeerTestHarness,
    staged: SlowAuditorPastEvidencePeriod
): Promise<RecordedDisputeSubmission> {
    const { forkId, slow, slowKills, slowSubmissions } = staged;
    await waitFor(
        async () =>
            (await slowSubmissions.submissions()).some(
                (submission) => submission.waited
            ),
        h.event.protocolEventTimeoutMs()
    );
    const recorded = await slowSubmissions.submissions();
    expect(recorded).to.have.length(1);
    const [multicall] = recorded;
    expect(multicall.method).to.equal("multicallBestEffortLast");
    expect(multicall.innerMethods[0]).to.equal("applyDisputeFraudProofs");
    expect(
        await h.channelManager.getWindowCommitments(h.channelId, forkId)
    ).to.have.length(1);
    expect(
        await h.execOnHost(
            slow,
            (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
            { forkId }
        )
    ).to.equal(false);
    await h.rpcStub.waitUntilDisputeMutexIdle(slow.index);
    expect(await eventPipelineOutcome(h, slow.index)).to.deep.equal({
        failedBlocks: 0,
        isDisposed: false
    });
    expect(await slowKills.applies()).to.deep.equal([]);
    expect(await slowSubmissions.submissions()).to.have.length(1);
    return multicall;
}

/**
 * Three participants and a spectator that joins (PENDING_PARTICIPANT) and is
 * then cut off. The participants author one more block: with `consumeJoin`
 * it consumes the JOIN and seats the joiner, whose missing signature leaves
 * it unfinalized; otherwise the authors leave the JOIN pending and the block
 * finalizes without the joiner. Timeout checks are suppressed.
 * Peer 0's dispute posts its auditing data (the pending joiner signed none).
 */
export async function stagePendingAuditorBehindJoin(
    h: MathPeerTestHarness,
    options: { consumeJoin: boolean }
) {
    await h.lifecycle.start(3, 0);
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2, 3] });
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    if (!options.consumeJoin)
        for (const index of [0, 1, 2])
            await h.byzantine.stubPendingInboundInclusion(index);
    const inboundBefore = await h
        .control(h.getPeer(0))
        .query.getLatestInboundMessageHash()
        .request();
    await h.join.joinChannelWait({ joiner: spectator });
    await h.assert.storage.honestPeersObserveInboundMessageWait({
        previousLatestHash: (inboundBefore ?? undefined) as Hash | undefined,
        peerIndices: [0, 1, 2]
    });
    await h.network.blacklistAndDisconnectPeer(spectator.index);
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 2] });
    const constructed = await h.dispute.fetchConstructedDispute(0);
    expect(constructed.dispute.postedAuditingData).to.equal(true);
    return { pendingIndex: spectator.index, ...constructed };
}

/** `peerIndex`'s view and membership: what a persistence-only replay must not move. */
export async function activeView(h: MathPeerTestHarness, peerIndex: number) {
    const peer = h.getPeer(peerIndex);
    const forkId = h.activeForkId!;
    return {
        nextBlockHeight: await h
            .control(peer)
            .query.getNextBlockHeight(forkId)
            .request(),
        status: await h.control(peer).query.getStatus().request(),
        ...(await h.execOnHost(peer, async (sm) => ({
            forceJoinCountingFromHeight:
                sm.storage.forceJoin.getCountingFromHeight() ?? null,
            forceJoinDisputeStarted: sm.storage.forceJoin.hasDisputeStarted()
        })))
    };
}

/** Until `count` of the recorded evidence audits have settled. */
export async function waitUntilAuditsSettled(
    h: MathPeerTestHarness,
    recorder: EvidenceComparisonRecording,
    count: number
): Promise<void> {
    await waitFor(
        async () =>
            (await recorder.audits()).filter(
                (audit) => audit.outcome !== "pending"
            ).length >= count,
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Whether a peer's event pipeline survived: logs whose handling failed keep
 * their block open (never pruned), and an internal failure disposes it.
 */
export async function eventPipelineOutcome(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<{ failedBlocks: number; isDisposed: boolean }> {
    return h.execOnHost(h.getPeer(peerIndex), (sm) => ({
        failedBlocks: [...sm.eventSyncService["blockStates"].values()]
            .flatMap((blocks) => [...blocks.values()])
            .filter((block) => block.failed).length,
        isDisposed: sm.isDisposed
    }));
}

/** A constructed dispute whose posted outbound run an auditor judges. */
export type StagedOutboundDispute = {
    forkId: ForkId;
    /** The chain anchor: the first leave's exit snapshot. */
    anchor: StateSnapshot;
    /** The second leaver's parked exit snapshot post. */
    heldPost: {
        waitUntilHeld: (timeoutMs?: number) => Promise<number>;
        release: () => Promise<string | null>;
    };
    disputerIndex: number;
    auditorIndex: number;
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
    /** Commit the dispute to its (edited) auditing data. */
    commit: () => void;
};

/**
 * `stageOutboundAroundAnchor` with two final blocks: the chain anchor holds
 * outbound block 1 (the first leave), the latest state outbound block 2 (the
 * second leave, its snapshot post held). The first remaining peer constructs
 * its dispute, whose posted run is the one block above the anchor; it states
 * existing-window admission as its reason and posts its auditing data. The
 * second remaining peer audits.
 */
export async function stageOutboundDispute(
    h: MathPeerTestHarness
): Promise<StagedOutboundDispute> {
    const { forkId, anchor, remaining, heldPost } =
        await stageOutboundAroundAnchor(h, { finalBlocks: 2 });
    const [disputerIndex, auditorIndex] = remaining;
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        disputerIndex,
        forkId
    );
    // premise: the posted run is the one block above the anchor
    expect(
        auditingData.outboundMessageBlocks.map(
            (block) => block.previousBlockHash
        )
    ).to.deep.equal([anchor.latestOutboundMessageBlockHash]);
    // Conditional admission supplies a reason, never an exception to proof validation.
    dispute.input.requireExistingDisputeWindow = true;
    dispute.postedAuditingData = true;
    return {
        forkId,
        anchor,
        heldPost,
        disputerIndex,
        auditorIndex,
        dispute,
        auditingData,
        commit: () => {
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
        }
    };
}

/**
 * `stageOutboundAroundAnchor` with two final blocks; the first remaining peer
 * posts its self-removal dispute with auditing data whose outbound run
 * (premise: the one block above the anchor) `forge` edits, recommitted, so
 * its own audit is bypassed. Returns once that dispute was killed.
 */
export async function postForgedOutboundRunDispute(
    h: MathPeerTestHarness,
    forge: (
        auditingData: DisputeAuditingDataStruct,
        dispute: DisputeStruct
    ) => void | Promise<void>
) {
    const { forkId, remaining, heldLeaver, heldPost } =
        await stageOutboundAroundAnchor(h, {
            finalBlocks: 2
        });
    const [disputerIndex, auditorIndex] = remaining;
    const disputer = h.getPeer(disputerIndex).address;
    // self-removal is the dispute's stated reason
    await h
        .control(h.getPeer(disputerIndex))
        .dispute.setForceExit(true)
        .request();
    await h.tamper.postTamperedDispute(
        disputerIndex,
        async (dispute, _, auditingData) => {
            if (!auditingData) throw new Error("auditing data missing");
            expect(auditingData.outboundMessageBlocks).to.have.length(1);
            await forge(auditingData, dispute);
            dispute.postedAuditingData = true;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
        },
        { forkId }
    );
    await waitFor(
        async () =>
            (
                await h.channelManager.queryFilter(
                    h.channelManager.filters.DisputeKilled(h.channelId)
                )
            ).some((log) => log.args.disputer === disputer),
        h.event.protocolEventTimeoutMs()
    );
    // the held leaver's exit is not on chain yet: it is still a participant
    // and audits (and may kill) like the remaining peers
    const auditors = [...remaining, heldLeaver];
    return { forkId, remaining, auditors, auditorIndex, disputer, heldPost };
}

/**
 * A `postForgedOutboundRunDispute` forge: the disputer signs a new last block
 * on top of its head that commits a forged latest snapshot. That snapshot's
 * outbound head is the posted block above the anchor with its first message
 * balance set to MaxUint256, so the links and the height hold while the sum
 * with the anchor's withdrawals overflows. The block is authentic and linked:
 * only the replay can reject the forged latest state.
 */
export function overflowingLatestHead(h: MathPeerTestHarness) {
    return async (
        auditingData: DisputeAuditingDataStruct,
        dispute: DisputeStruct
    ): Promise<void> => {
        const [block] = auditingData.outboundMessageBlocks;
        const overflowing = {
            ...block,
            messages: block.messages.map((message, index) =>
                index === 0
                    ? {
                          ...message,
                          balance: { ...message.balance, amount: MaxUint256 }
                      }
                    : message
            )
        };
        const latest = auditingData.latestStateSnapshot;
        const forged = StateSnapshot.from({
            ...latest,
            snapshotData: {
                ...latest.snapshotData,
                latestOutboundMessageBlockHash: hash(
                    Codec.encode(overflowing, Type.MessageBlock)
                )
            }
        });
        const milestone = dispute.input.stateProof.milestones.at(-1)!;
        const head = Block.fromBlockConfirmation(
            milestone.blockConfirmations.at(-1)!
        );
        const disputer = h.peers.find(
            (peer) => peer.address === dispute.input.disputer
        );
        if (!disputer) throw new Error("No harness peer is the disputer");
        const encoded = await buildAndEncodeBlock(disputer.signer, {
            header: {
                channelId: h.channelId,
                forkId: head.forkId,
                transactionCnt: head.height + 1
            },
            previousBlockHash: head.hash,
            stateSnapshotHash: forged.hash
        });
        milestone.blockConfirmations.push(
            Codec.decode(encoded, Type.BlockConfirmation)
        );
        auditingData.outboundMessageBlocks = [overflowing];
        auditingData.latestStateSnapshot = forged.toStruct();
        dispute.input.latestStateSnapshotHash = forged.hash;
    };
}

/**
 * The auditor's audit of the staged dispute returns false and stores one
 * DisputeInvalidOutboundRun, which the chain accepts.
 */
export async function expectInvalidOutboundRun(
    h: MathPeerTestHarness,
    staged: StagedOutboundDispute
): Promise<void> {
    const run = await h.dispute.auditDispute(
        staged.auditorIndex,
        staged.dispute,
        staged.auditingData
    );
    expect(run).to.include({ outcome: "returned", isValid: false });
    expect(run.storedProof?.disputeFraudProofType).to.equal(
        DisputeFraudProofType.DisputeInvalidOutboundRun
    );
    expect(run.disputeFraudProofCount).to.equal(1);
    expect(
        await h.channelManager.isDisputeOutboundRunInvalid.staticCall(
            staged.dispute,
            Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidOutboundRun
            )
        )
    ).to.equal(true);
}

/**
 * Spawn a spectator authored over by `authoringPeerIndices` that cannot reach
 * `isolatedIndices` until it synced (its initial sync comes from a live
 * participant), then reconnect it (a join needs every on-chain threshold
 * participant) and join it: it is PENDING_PARTICIPANT, with its timeout
 * checks and its force-join route suppressed.
 */
async function joinLateAuditorAwayFrom(
    h: MathPeerTestHarness,
    authoringPeerIndices: number[],
    isolatedIndices: number[]
) {
    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices,
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true,
        beforeConnect: async (created) => {
            for (const isolatedIndex of isolatedIndices) {
                const isolated = h.getPeer(isolatedIndex);
                await h
                    .control(created)
                    .network.blacklistAndDisconnectPeerByAddress(
                        isolated.address
                    )
                    .request();
                await h
                    .control(isolated)
                    .network.blacklistAndDisconnectPeerByAddress(
                        created.address
                    )
                    .request();
            }
        }
    });
    await h.rpcStub.suppressTimeoutCheck(peer.index);
    // its force-join route stays closed: its only dispute route left is the
    // newer-state submission an audit's evidence comparison starts
    await h.control(peer).stub.stubSuppressForceJoinDispute().request();
    await h.network.reconnectPeers([peer.index]);
    await h.join.joinChannelWait({ joiner: peer });
    return peer.index;
}

/**
 * Three participants whose authors leave every JOIN unconsumed, so the chain
 * anchor stays the genesis and joiners stay pending. A first spectator joins
 * (the pending disputer); its view is then frozen (it ingests no later block)
 * while the participants finalize two more blocks. A second spectator syncs
 * past the disputer's state, never from the disputer, and joins (the
 * pending auditor). The disputer never signs (pending peers do not), its own
 * dispute initiation is suppressed, and its constructed dispute names its
 * frozen latest state with the unconsumed JOIN as its reason.
 */
export async function stagePendingDisputerBehindLateAuditor(
    h: MathPeerTestHarness
) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    for (const index of [0, 1, 2]) {
        await h.rpcStub.suppressTimeoutCheck(index);
        await h.byzantine.stubPendingInboundInclusion(index);
    }
    const { peer: disputer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true
    });
    await h.rpcStub.suppressTimeoutCheck(disputer.index);
    await h.dispute.suppressDisputeInitiation([disputer.index]);
    await h.join.joinChannelWait({ joiner: disputer });
    await h.assert.sync.peersInSyncWait({
        peerIndices: [0, 1, 2, disputer.index]
    });
    await h.control(disputer).stub.stubRejectIngestedConfirmations().request();
    const olderHeight = (await h
        .control(disputer)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    const auditorIndex = await joinLateAuditorAwayFrom(
        h,
        [0, 1, 2],
        [disputer.index]
    );
    const olderSnapshot = await snapshotAt(h, 0, olderHeight);
    expect(
        await holdsState(h, auditorIndex, olderSnapshot),
        "the late auditor must not hold the disputer's state"
    ).to.equal(false);
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        disputer.index
    );
    expect(dispute.input.latestStateSnapshotHash).to.equal(olderSnapshot.hash);
    expect(
        dispute.input.requireExistingDisputeWindow,
        "the unconsumed JOIN is the dispute's own reason"
    ).to.equal(false);
    return {
        forkId,
        disputerIndex: disputer.index,
        auditorIndex,
        olderHeight,
        olderSnapshot,
        dispute,
        auditingData
    };
}

/**
 * Three participants; the next writer leaves, its exit post is held (it stays
 * chain-eligible) and its view is then frozen at its leave block (it ingests
 * no later block). A late spectator syncs past it, never from the leaver,
 * and joins (the pending auditor). The leaver asks to leave by dispute: its
 * constructed dispute names its last signed state.
 *
 * With `nextAuthorLeaves` there are four participants and the next author
 * after the leave block also leaves (its exit post is held too), so the
 * block after the leave block changes the set: the auditor's sync keeps
 * that block and the leave block's snapshot, but not the leave state. The
 * auditor never syncs from either leaver.
 */
export async function stageDepartedDisputerBehindLateAuditor(
    h: MathPeerTestHarness,
    options?: { nextAuthorLeaves?: boolean }
) {
    await h.scenario.preDisputeSetup({
        peerCount: options?.nextAuthorLeaves ? 4 : 3,
        transitionCount: 2
    });
    const forkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const leaver = await h.query.getNextPeerToWrite();
    await h.rpcStub.holdSnapshotPostSend(leaver.index);
    await h.dispute.suppressDisputeInitiation([leaver.index]);
    let remaining = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== leaver.index);
    await h.transition.participantLeaveStateTransition({
        leaverIndex: leaver.index,
        waitForPeers: remaining
    });
    await h.control(leaver).stub.stubRejectIngestedConfirmations().request();
    const leaveHeight = (await h
        .control(leaver)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const leaverIndices = [leaver.index];
    if (options?.nextAuthorLeaves) {
        const nextLeaver = await h.query.getNextPeerToWrite();
        await h.rpcStub.holdSnapshotPostSend(nextLeaver.index);
        await h.dispute.suppressDisputeInitiation([nextLeaver.index]);
        remaining = remaining.filter((index) => index !== nextLeaver.index);
        await h.transition.participantLeaveStateTransition({
            leaverIndex: nextLeaver.index,
            waitForPeers: remaining
        });
        leaverIndices.push(nextLeaver.index);
    }
    const auditorIndex = await joinLateAuditorAwayFrom(
        h,
        remaining,
        leaverIndices
    );
    const leaveSnapshot = await snapshotAt(h, remaining[0]!, leaveHeight);
    expect(
        await holdsState(h, auditorIndex, leaveSnapshot),
        "the late auditor must not hold the departed signer's last state"
    ).to.equal(false);
    await h.control(leaver).dispute.setForceExit(true).request();
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        leaver.index
    );
    expect(dispute.input.latestStateSnapshotHash).to.equal(leaveSnapshot.hash);
    return {
        forkId,
        leaverIndex: leaver.index,
        /** the second leaver, with `nextAuthorLeaves` */
        nextLeaverIndex: leaverIndices[1],
        remaining,
        auditorIndex,
        leaveHeight,
        leaveSnapshot,
        dispute,
        auditingData
    };
}

/**
 * Four peers, blocks 0 and 1 final. The author of block 1 stays connected
 * but drops every block the network delivers (its view stays at block 1)
 * while the others author two more blocks that cannot become final without
 * it. Timeout checks are suppressed on every peer.
 */
export async function stageLaggingParticipantBehindTail(
    h: MathPeerTestHarness
) {
    await h.scenario.preDisputeSetup({ peerCount: 4, transitionCount: 2 });
    const forkId: ForkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const latest = await h
        .control(h.getPeer(0))
        .query.getLatestBlockInfo(forkId)
        .request();
    // the latest author writes again only after every other peer
    const lagging = h.peers.find((peer) => peer.address === latest!.author)!;
    const laggingHeight = (await h
        .control(lagging)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    await h.control(lagging).stub.stubDropNetworkConfirmations().request();
    const live = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== lagging.index);
    await h.transition.advanceState({ count: 2, waitForPeers: live });
    return { forkId, laggingIndex: lagging.index, laggingHeight, live };
}

/**
 * Every peer's kill and reduction are held. Once the timeout window after
 * the frozen leaver's last block has passed, the leaver times out `accused`
 * at the next height and uploads that dispute (the chain opens its window).
 * Returns the committed dispute, its auditing data when posted, and the
 * accused height.
 */
export async function postDepartedTimeoutOf(
    h: MathPeerTestHarness,
    options: { leaverIndex: number; accused: string }
) {
    for (const peer of h.peers) {
        await h.rpcStub.holdReductionRace(peer.index);
        await h.rpcStub.suppressDisputeKill(peer.index);
    }
    const leaver = h.getPeer(options.leaverIndex);
    const leaveBlock = (await h
        .control(leaver)
        .query.getLatestBlockInfo(h.activeForkId!)
        .request())!;
    const { header } = Codec.decode(
        leaveBlock.encodedBlock,
        Type.Block
    ).transaction;
    const accusedHeight = Number(header.transactionCnt) + 1;
    // time is the input here: the claim must be timely to reach its counter
    await waitUntilTimeoutIsTimely(h, Number(header.timestamp), accusedHeight);
    await h.tamper.plantFreshTimeoutForParticipant(
        options.leaverIndex,
        options.accused
    );
    let postedAuditingData: DisputeAuditingDataStruct | undefined;
    const { dispute } = await h.tamper.postTamperedDispute(
        options.leaverIndex,
        (_dispute, _confirmation, auditingData) => {
            postedAuditingData = auditingData;
        }
    );
    expect(Number(dispute.input.timeout.blockHeight)).to.equal(accusedHeight);
    expect(dispute.input.timeout.participant).to.equal(options.accused);
    return {
        dispute,
        auditingData: dispute.postedAuditingData
            ? postedAuditingData
            : undefined,
        accusedHeight
    };
}

/**
 * Three colluding participants and a chain anchor A at their latest final
 * block. Their authors leave every JOIN unconsumed; a spectator (Charlie)
 * syncs past A over real final blocks and joins (PENDING_PARTICIPANT), so it
 * holds those blocks from its synced final point on but not the state at A.
 * The colluders' dispute keeps A as its last milestone's first block and
 * forks right after it: a tail from A + 1 to one block past Charlie's view,
 * each block authentic, linked and signed by a participant other than the
 * real block's author. The dispute omits its auditing data (the last
 * milestone holds the anchor).
 */
export async function stageColludersForkAfterAnchor(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    await h.transition.advanceState({ count: 1, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    const anchor = await postSnapshotPastLaggingMirrors(h, []);
    const forkId = h.activeForkId!;
    for (const index of [0, 1, 2]) {
        await h.rpcStub.suppressTimeoutCheck(index);
        await h.byzantine.stubPendingInboundInclusion(index);
    }
    const { peer: charlie } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true
    });
    await h.rpcStub.suppressTimeoutCheck(charlie.index);
    await h.join.joinChannelWait({ joiner: charlie });
    expect(
        await holdsState(h, charlie.index, anchor),
        "Charlie must not hold the state at the anchor"
    ).to.equal(false);
    const charlieHeight = (await h
        .control(charlie)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    expect(charlieHeight).to.be.greaterThan(anchor.blockHeight);
    const { dispute } = await h.dispute.fetchConstructedDispute(0);
    const run = [await blockConfirmationAt(h, 0, anchor.blockHeight)];
    for (
        let height = anchor.blockHeight + 1;
        height <= charlieHeight + 1;
        height++
    ) {
        const real = await h
            .control(h.getPeer(0))
            .query.getBlockByHeight(forkId, height)
            .request();
        const previous = Block.fromBlockConfirmation(run.at(-1)!);
        run.push(
            await craftInvalidLinkedBlock(h, {
                height,
                previousBlockHash: previous.hash,
                notAuthor: (real?.author ?? previous.author) as Address
            })
        );
    }
    replaceStateProof(dispute, [{ blockConfirmations: run }]);
    return {
        forkId,
        anchor,
        charlieIndex: charlie.index,
        charlieHeight,
        dispute
    };
}

/**
 * A pending auditor that holds no final block at the next head (plan E15:
 * the colluders' final block is one this auditor never signed). A spectator
 * syncs while `authors` author, is persistently isolated, then the
 * authors finalize one more block (the head the colluders forge) and the
 * spectator joins (PENDING_PARTICIPANT, its JOIN unconsumed, so it is not in
 * that head's required set). Its local final point stays below the head.
 * The authors' writer-timeout checks are off. `restoreGossip` gives the
 * auditor its network connection back.
 */
export async function stageBlindPendingAuditor(
    h: MathPeerTestHarness,
    authors: number[]
) {
    const forkId = h.activeForkId!;
    // the channel idles while the dispute is posted: no writer timeout races it
    for (const index of authors) await h.rpcStub.suppressTimeoutCheck(index);
    const auditorIndex = await addFreshSpectator(h, {
        authoringPeerIndices: authors
    });
    await h.rpcStub.suppressTimeoutCheck(auditorIndex);
    // Gossip suppression alone still permits a sync response to reveal the head.
    await h.network.blacklistAndDisconnectPeer(auditorIndex);
    const restoreGossip = async () => {
        await h.network.restorePeerDiscovery([auditorIndex]);
    };
    await h.transition.advanceState({
        count: 1,
        waitForPeers: authors,
        waitForFinalization: true
    });
    await joinAsPendingParticipant(h, auditorIndex, authors);
    await waitForChainInboundHead(h, [...authors, auditorIndex]);
    const headHeight = Number(
        await h
            .control(h.getPeer(authors[0]!))
            .query.getLatestBlockHeight(forkId)
            .request()
    );
    expect(
        (await localFinalizedHeight(h, auditorIndex)) ?? -1,
        "the auditor never finalized the head"
    ).to.be.lessThan(headHeight);
    return { auditorIndex, headHeight, restoreGossip };
}

/**
 * `disputerIndex` re-signs its final head with total deposits one higher
 * (the balance invariant fails), signed by every harness peer but
 * `outsideColluders`, and uploads its dispute with that head and the forged
 * snapshot committed in its posted auditing data. Returns the forged head.
 */
export async function postForgedDepositsHead(
    h: MathPeerTestHarness,
    disputerIndex: number,
    outsideColluders: number[]
): Promise<{ hash: string; encodedBlock: string }> {
    const prepared = await prepareForgedDepositsHead(
        h,
        disputerIndex,
        outsideColluders
    );
    await h.tamper.postTamperedDispute(disputerIndex, prepared.tamper);
    return prepared.head;
}

// Signing the colluded head must not consume an already-open evidence window.
async function prepareForgedDepositsHead(
    h: MathPeerTestHarness,
    disputerIndex: number,
    outsideColluders: number[]
) {
    const forged = await h.tamper.buildForgedSnapshot(
        disputerIndex,
        (ctx) => ({
            snapshotData: {
                ...ctx.originalSnapshotData,
                totalDeposits: {
                    ...ctx.originalSnapshotData.totalDeposits,
                    amount:
                        BigInt(ctx.originalSnapshotData.totalDeposits.amount) +
                        1n
                }
            }
        }),
        { withoutSignerIndices: outsideColluders }
    );
    expect(
        BigInt(forged.originalSnapshot.snapshotData.totalDeposits.amount)
    ).to.be.greaterThan(0n);

    const tamper: DisputeTamper = (dispute, _confirmation, auditingData) => {
        if (!auditingData) {
            throw new Error("expected dispute auditing data");
        }

        // the forged block replaces the latest block, which is the
        // first block of the last (threshold-final) milestone
        const milestone = dispute.input.stateProof.milestones.at(-1);
        if (milestone?.blockConfirmations.length !== 1) {
            throw new Error(
                "expected the last milestone to hold only the latest block"
            );
        }
        milestone.blockConfirmations[0] =
            forged.forgedBlock.blockConfirmationStruct;
        auditingData.milestoneSnapshots[
            auditingData.milestoneSnapshots.length - 1
        ] = forged.forgedSnapshot.toStruct();

        auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
        dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
        dispute.input.disputeAuditingDataHash = hash(
            Codec.encode(auditingData, Type.DisputeAuditingData)
        );
        dispute.postedAuditingData = true;
    };
    return {
        tamper,
        head: {
            hash: String(forged.forgedBlock.hash),
            encodedBlock: Codec.encode(
                forged.forgedBlock.blockStruct,
                Type.Block
            ) as string
        }
    };
}

/**
 * The killed submitter's colluders also signed the real head: after the
 * forged dispute's kill each answers with its own real-head dispute. The
 * pending auditor verified the forged head as threshold-final, so it kills
 * each of them with DisputeConflictsWithFinalState (two realities cannot
 * both be final under one honest peer). The channel then reduces from the
 * auditor's own dispute alone: every disputing colluder and the submitter
 * are slashed and no fatal reduction stops the auditor. `remainingIndices`
 * are the peers the new fork keeps (default: the auditor alone); a colluder
 * that never disputed is not slashed and stays.
 */
export async function assertColludersKilledByConflict(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        auditorIndex: number;
        submitterIndex: number;
        colluderIndices: number[];
        remainingIndices?: number[];
    }
): Promise<void> {
    const auditor = h.getPeer(options.auditorIndex);
    const isKilled = async (disputer: Address) =>
        (
            await h.channelManager.queryFilter(
                h.channelManager.filters.DisputeKilled(h.channelId)
            )
        ).some((log) => log.args.disputer === disputer);
    for (const index of options.colluderIndices) {
        const colluder = h.getPeer(index);
        await waitFor(
            () => isKilled(colluder.address),
            h.event.protocolEventTimeoutMs()
        );
        const kill = await readDisputeKill(h, colluder.address);
        expect(kill.killer, `colluder ${index}'s dispute`).to.equal(
            auditor.address
        );
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeConflictsWithFinalState
        ]);
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: index });
    }
    await h.dispute.resolveDisputeWait({
        forkId: options.forkId,
        honestPeerIndices: options.remainingIndices ?? [options.auditorIndex]
    });
    const slashedIndices = [options.submitterIndex, ...options.colluderIndices];
    await h.assert.dispute.slashedOnChainExactly(
        slashedIndices.map((index) => h.getPeer(index).address)
    );
    const reduction = await readWindowReduction(
        h,
        options.auditorIndex,
        options.forkId
    );
    expect(reduction.disputers).to.deep.equal([auditor.address]);
}

/** Until `auditorIndex` stores `head` (the block a dispute it audits proved), at its height. */
export async function waitUntilAuditorStoredBlockAt(
    h: MathPeerTestHarness,
    auditorIndex: number,
    forkId: ForkId,
    head: { hash: string; encodedBlock: string } | null
): Promise<void> {
    if (!head) throw new Error("waitUntilAuditorStoredBlockAt: no head block");
    const height = Number(
        Codec.decode(head.encodedBlock, Type.Block).transaction.header
            .transactionCnt
    );
    await waitFor(
        async () =>
            (await h
                .control(h.getPeer(auditorIndex))
                .query.getBlockHashAt(forkId, height)
                .request()) === head.hash,
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * The conflict counter `proof` against `dispute` rests on a threshold-final
 * block `auditorIndex` holds: the counter's dispute block sits above the
 * chain anchor and at most at the auditor's final height, the counter's
 * final proof walks on chain to exactly that block's height, and the
 * auditor's stored block there is another block committing that final
 * snapshot. Any final block the auditor verified qualifies, not only its
 * view's latest final point.
 */
export async function expectConflictWithAuditorsFinalBlock(
    h: MathPeerTestHarness,
    options: {
        auditorIndex: number;
        dispute: DisputeStruct;
        proof: DisputeConflictsWithFinalStateStruct;
        anchorHeight: number;
        auditorFinalHeight: number;
    }
): Promise<void> {
    const { dispute, proof } = options;
    const conflicting = Block.fromBlockConfirmation(
        dispute.input.stateProof.milestones[Number(proof.milestoneIndex)]!
            .blockConfirmations[Number(proof.blockIndex)]!
    );
    expect(conflicting.height).to.be.greaterThan(options.anchorHeight);
    expect(conflicting.height).to.be.at.most(options.auditorFinalHeight);
    const walk = await h.channelManager.verifyMilestones.staticCall(
        proof.finalProof
    );
    expect(walk.valid, "the final proof walks on chain").to.equal(true);
    expect(Number(walk.finalizedSnapshot.blockHeight)).to.equal(
        conflicting.height
    );
    expect(StateSnapshot.from(walk.finalizedSnapshot).hash).to.not.equal(
        conflicting.stateSnapshotHash
    );
    const stored = await h
        .control(h.getPeer(options.auditorIndex))
        .query.getBlockHashAt(
            dispute.input.forkId as ForkId,
            conflicting.height
        )
        .request();
    expect(stored, "the auditor holds its own block there").to.not.equal(null);
    expect(stored).to.not.equal(conflicting.hash);
}

/**
 * Three participants and a blind pending auditor (`stageBlindPendingAuditor`)
 * whose audit proof walks are parked. Peer 0 opens the window with its
 * real-head self-removal dispute, peer 1 adds its real-head dispute to that
 * window, and peer 2 posts the forged-head dispute (`postForgedDepositsHead`):
 * all three audits pass their pre-walk conflict checks with nothing stored at
 * the head's height and park before the walk. The participants' kills and
 * their other disputes are suppressed: only the auditor's counters land.
 */
export async function stageParallelHeadAudits(h: MathPeerTestHarness) {
    // The window opens before the audits are parked, so the evidence period
    // covers the two later uploads, the held walks and their release, the
    // three audits, and the auditor's own kill-and-dispute upload. Use the
    // approved balance-invariant evidence window, as the other audit orders.
    await h.scenario.preDisputeSetup({ timeConfig: { evidenceTime: 15 } });
    const forkId = h.activeForkId!;
    const { auditorIndex, restoreGossip } = await stageBlindPendingAuditor(
        h,
        [0, 1, 2]
    );
    await Promise.all(
        [0, 1, 2].map((index) => h.rpcStub.suppressDisputeKill(index))
    );
    await h.dispute.suppressDisputeInitiation([0, 1, 2]);
    const walks = await h.rpcStub.holdProofWalks(auditorIndex);

    const realHead = (await h
        .control(h.getPeer(0))
        .query.getLatestBlockInfo(forkId)
        .request())!;
    const forged = await prepareForgedDepositsHead(h, 2, [auditorIndex]);
    await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
    h.context.leftChannelPeerIndices = [...h.context.leftChannelPeerIndices, 0];
    const [openWindow, postRealHead, postForgedHead] = await Promise.all([
        h.tamper.prepareTamperedDispute(0, () => {}, { markMalicious: false }),
        // the open window is peer 1's reason
        h.tamper.prepareTamperedDispute(
            1,
            (dispute) => {
                dispute.input.requireExistingDisputeWindow = true;
            },
            { markMalicious: false }
        ),
        h.tamper.prepareTamperedDispute(2, forged.tamper)
    ]);
    await openWindow();
    // Both later submissions depend on that opening, not on each other.
    await Promise.all([postRealHead(), postForgedHead()]);
    const forgedHead = forged.head;
    await walks.waitUntilHeld([realHead.hash, realHead.hash, forgedHead.hash]);
    const headHeight = Number(
        Codec.decode(realHead.encodedBlock, Type.Block).transaction.header
            .transactionCnt
    );
    expect(
        await h
            .control(h.getPeer(auditorIndex))
            .query.getBlockHashAt(forkId, headHeight)
            .request(),
        "no head is stored while the audits are parked"
    ).to.equal(null);
    return {
        forkId,
        auditorIndex,
        restoreGossip,
        walks,
        realHead,
        forgedHead,
        headHeight
    };
}

/**
 * Time is the test input: wait until a timeout of the block after one
 * stamped `previousTimestamp` is no longer early at `accusedHeight`. The
 * deadline is the protocol's own wait (`timeoutWaitTime` of the session's
 * timeConfig); the margin past it is one `p2pTime`, the clock tolerance the
 * protocol gives a writer, so the window's block stamp cannot fall before
 * the deadline when the local clock leads the chain's.
 */
export async function waitUntilTimeoutIsTimely(
    h: MathPeerTestHarness,
    previousTimestamp: number,
    accusedHeight: number
): Promise<void> {
    const timeConfig = resolveTestTimeConfig(h.options.timeConfig);
    await h.event.waitUntilTimestamp(
        previousTimestamp +
            timeoutWaitTime(timeConfig, accusedHeight) +
            timeConfig.p2pTime
    );
}

/**
 * Peer 0 posts a valid timeout dispute against the real next writer once
 * the writer's full wait has passed. Reductions and the peers' own timeout
 * checks are held, so the committed dispute stays under audit and no
 * natural timeout dispute races it. Returns the window's creation
 * timestamp and the timeout's deadline (head timestamp + timeoutWaitTime).
 */
export async function postTimelyNextWriterTimeout(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup();
    const forkId = h.activeForkId!;
    for (const peer of h.peers) {
        await h.rpcStub.holdReductionRace(peer.index);
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    }
    const head = await h
        .control(h.getPeer(0))
        .query.getLatestBlockInfo(forkId)
        .request();
    const { header } = Codec.decode(head!.encodedBlock, Type.Block).transaction;
    const headTs = Number(header.timestamp);
    const wait = timeoutWaitTime(
        resolveTestTimeConfig(),
        Number(header.transactionCnt) + 1
    );
    // plant first: the upload's window-created-too-early guard compares
    // against the timeout's minTimeStamp (set at plant time)
    await h.tamper.plantFreshTimeoutForNextWriter(0);
    await h.event.waitUntilTimestamp(headTs + wait + 2);
    const { dispute } = await h.tamper.postTamperedDispute(0, () => {}, {
        markMalicious: false
    });
    const windowTs = Number(
        await h.channelManager.getDisputeWindowCreationTimestamp(
            h.channelId,
            forkId
        )
    );
    return { dispute, windowTs, deadline: headTs + wait };
}

/**
 * Once `auditorIndex` finished its own audit of the committed timeout
 * `dispute`, a replay-shaped task holds its state mutex with the
 * predecessor of the disputed state (the state below the latest block)
 * installed on the shared state machine, and writes it again after any
 * other task's state write while held.
 */
export async function holdReplayOnPredecessorState(
    h: MathPeerTestHarness,
    auditorIndex: number,
    dispute: DisputeStruct
) {
    await h.event.waitForEventCounts(
        "onDisputeCommitted",
        [{ peerId: auditorIndex, expectedCount: 1 }],
        undefined,
        { mode: "atLeast" }
    );
    await h.rpcStub.waitUntilDisputeMutexIdle(auditorIndex);
    const stub = () => h.control(h.getPeer(auditorIndex)).stub;
    await stub()
        .holdStateMutexOnState(Number(dispute.input.timeout.blockHeight) - 2)
        .request();
    await waitFor(
        async () => (await stub().getStateMutexHeldCount().request()) === 1,
        h.event.protocolEventTimeoutMs()
    );
    return {
        state: async () => (await stub().getStateMutexStateHold().request())!,
        stillHeld: async () =>
            (await stub().getStateMutexHeldCount().request()) === 1,
        release: async () => {
            await stub().releaseStateMutex().request();
        }
    };
}

/**
 * Three participants whose authors at first leave every JOIN unconsumed. A
 * spectator (Charlie) syncs, joins (PENDING_PARTICIPANT, its force-join and
 * timeout routes suppressed) and is cut off. The participants finalize two
 * blocks without it (the last is `baseHeight`), then consume Charlie's JOIN
 * in the next block (`hopHeight`), which seats Charlie and so cannot become
 * final without him. Charlie holds neither the blocks nor the state at
 * `baseHeight`. Peer 0's dispute (posted auditing data) has the final block
 * at `baseHeight` as its last milestone's first block and the JOIN block as
 * its tail.
 */
export async function stagePendingJoinerMissingHopBase(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    const restoreInclusion: (() => Promise<void>)[] = [];
    for (const index of [0, 1, 2]) {
        await h.rpcStub.suppressTimeoutCheck(index);
        restoreInclusion.push(
            await h.byzantine.stubPendingInboundInclusion(index)
        );
    }
    const { peer: charlie } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true
    });
    await h.rpcStub.suppressTimeoutCheck(charlie.index);
    await h.control(charlie).stub.stubSuppressForceJoinDispute().request();
    const inboundBefore = await h
        .control(h.getPeer(0))
        .query.getLatestInboundMessageHash()
        .request();
    await h.join.joinChannelWait({ joiner: charlie });
    await h.assert.storage.honestPeersObserveInboundMessageWait({
        previousLatestHash: (inboundBefore ?? undefined) as Hash | undefined,
        peerIndices: [0, 1, 2, charlie.index]
    });
    await h.network.blacklistAndDisconnectPeer(charlie.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    const baseHeight = (await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    for (const restore of restoreInclusion) await restore();
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 2] });
    const hopHeight = baseHeight + 1;
    const hopSnapshot = await snapshotAt(h, 0, hopHeight);
    expect(
        hopSnapshot.snapshotData.participants.map(String),
        "the next block seats Charlie"
    ).to.include(charlie.address);
    const baseSnapshot = await snapshotAt(h, 0, baseHeight);
    expect(
        await holdsState(h, charlie.index, baseSnapshot),
        "Charlie must not hold the hop's preceding state"
    ).to.equal(false);
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    expect(dispute.postedAuditingData).to.equal(true);
    const head = Block.fromBlockConfirmation(
        dispute.input.stateProof.milestones.at(-1)!.blockConfirmations.at(-1)!
    );
    expect(head.height).to.equal(hopHeight);
    return {
        forkId,
        charlieIndex: charlie.index,
        baseHeight,
        baseSnapshot,
        hopHeight,
        dispute,
        auditingData
    };
}

/**
 * {@link stageMirrorMissingConsumedTopUp} (three peers, peer 1's mirror
 * misses the consumed top-up) and then peer 0 posts its latest final block
 * as the chain anchor while peer 1 also holds that snapshot event. Peer 1
 * proves no local final point and its mirror walks from the genesis; peer 2
 * mirrors the anchor.
 */
export async function stageLaggingAuditorBelowAnchor(h: MathPeerTestHarness) {
    await stageMirrorMissingConsumedTopUp(h, 1);
    const anchor = await postSnapshotPastLaggingMirrors(h, [1]);
    expect(
        await localFinalizedHeight(h, 1),
        "the lagging auditor proves no local final point"
    ).to.equal(null);
    return { anchor, currentIndex: 2, laggingIndex: 1 };
}

/**
 * Three participants. A spectator (Charlie) syncs and stops receiving block
 * gossip. The participants then finalize two blocks, post the chain anchor A
 * at the latest and author block A + 1, none of which Charlie holds; Charlie
 * then joins (PENDING_PARTICIPANT). The join comes after the anchor post: an
 * unconsumed JOIN on chain blocks a snapshot update. Peer 0's
 * dispute is the participants' real history from the anchor: the run holding
 * A with A + 1 as its tail, auditing data omitted under the anchor rule. No
 * block of it conflicts with a final block Charlie holds, and Charlie lacks
 * the state at A its tail replay needs.
 */
export async function stageBlindPendingBelowRealAnchor(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    for (const index of [0, 1, 2]) await h.rpcStub.suppressTimeoutCheck(index);
    const { peer: charlie } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true
    });
    await h.rpcStub.suppressTimeoutCheck(charlie.index);
    await h.rpcStub.dropNetworkConfirmations(charlie.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    const anchor = await h.transition.postSnapshotWait();
    if (!anchor) throw new Error("No finalized snapshot to anchor on chain");
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    await h.join.joinChannelWait({ joiner: charlie });
    expect(
        await holdsState(h, charlie.index, anchor),
        "Charlie must not hold the state at the anchor"
    ).to.equal(false);
    for (const height of [anchor.blockHeight, anchor.blockHeight + 1])
        expect(
            await h
                .control(charlie)
                .query.getBlockHashAt(forkId, height)
                .request(),
            `Charlie holds no block at ${height}`
        ).to.equal(null);
    await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
    const { dispute } = await h.dispute.fetchConstructedDispute(0);
    replaceStateProof(dispute, [
        {
            blockConfirmations: [
                await blockConfirmationAt(h, 0, anchor.blockHeight),
                await blockConfirmationAt(h, 0, anchor.blockHeight + 1)
            ]
        }
    ]);
    return { forkId, anchor, charlieIndex: charlie.index, dispute };
}

/** A frozen spectator audits two valid virtual-final walks with conflicting commitments at height 2. */
export async function runConcurrentVirtualFinalAudits(
    h: MathPeerTestHarness,
    forgedFirst: boolean
) {
    let served = "";
    const { forkId, observerIndex } = await stageFinalityFromNextBlock(
        h,
        async () => {
            const payload = await h
                .control(h.getPeer(1))
                .spectate.generateSyncPayload(h.channelId, h.activeForkId!, 1)
                .request();
            if (!payload) throw new Error("The initial state was not served");
            served = payload.encodedSyncPayload;
        }
    );
    const auditor = await syncSpectatorOnServedPayload(
        h,
        served,
        [0, 1, 2],
        [],
        async (peer) => {
            await h.rpcStub.dropNetworkConfirmations(peer.index);
        }
    );
    const real = await h.dispute.fetchConstructedDispute(observerIndex);
    expect(
        real.dispute.input.stateProof.milestones.map((milestone) =>
            milestone.blockConfirmations.map(
                (confirmation) =>
                    Block.fromBlockConfirmation(confirmation).height
            )
        ),
        "the fixture still needs block 3 to prove block 2"
    ).to.deep.equal([[2, 3]]);
    const forged = {
        dispute: Codec.decode(
            Codec.encode(real.dispute, Type.Dispute),
            Type.Dispute
        ),
        auditingData: Codec.decode(
            Codec.encode(real.auditingData, Type.DisputeAuditingData),
            Type.DisputeAuditingData
        )
    };
    const run = forged.dispute.input.stateProof.milestones.at(-1)!;
    const firstSnapshot = StateSnapshot.from(
        forged.auditingData.milestoneSnapshots.at(-1)!
    );
    const lastSnapshot = StateSnapshot.from(
        forged.auditingData.latestStateSnapshot
    );
    const forgeSnapshot = (snapshot: StateSnapshot) =>
        StateSnapshot.from({
            ...snapshot.toStruct(),
            snapshotData: {
                ...snapshot.snapshotData,
                totalDeposits: {
                    ...snapshot.snapshotData.totalDeposits,
                    amount:
                        BigInt(snapshot.snapshotData.totalDeposits.amount) + 1n
                }
            }
        });
    const forgedFirstSnapshot = forgeSnapshot(firstSnapshot);
    const forgedLastSnapshot = forgeSnapshot(lastSnapshot);
    let previous: Block | undefined;
    for (let index = 0; index < run.blockConfirmations.length; index++) {
        const original = Block.fromBlockConfirmation(
            run.blockConfirmations[index]
        );
        const author = h.peers.find(
            (peer) => peer.address === original.author
        )!;
        const block = await Block.fromBlockStruct(
            {
                ...original.blockStruct,
                previousBlockHash: previous?.hash ?? original.previousBlockHash,
                stateSnapshotHash:
                    index === 0
                        ? forgedFirstSnapshot.hash
                        : forgedLastSnapshot.hash
            },
            author.signer
        );
        for (const signer of original.confirmationSignerAddresses) {
            const peer = h.peers.find(
                (candidate) => candidate.address === signer
            )!;
            block.expandSignatures([await block.sign(peer.signer)]);
        }
        run.blockConfirmations[index] = block.blockConfirmationStruct;
        previous = block;
    }
    forged.auditingData.milestoneSnapshots[
        forged.auditingData.milestoneSnapshots.length - 1
    ] = forgedFirstSnapshot.toStruct();
    forged.auditingData.latestStateSnapshot = forgedLastSnapshot.toStruct();
    forged.dispute.input.latestStateSnapshotHash = forgedLastSnapshot.hash;
    forged.dispute.input.disputeAuditingDataHash = hash(
        Codec.encode(forged.auditingData, Type.DisputeAuditingData)
    );
    forged.dispute.postedAuditingData = true;
    const realLast = Block.fromBlockConfirmation(
        real.dispute.input.stateProof.milestones
            .at(-1)!
            .blockConfirmations.at(-1)!
    ).hash;
    const forgedLast = previous!.hash;
    const held = await h.rpcStub.holdProofWalks(auditor.index);
    const realAudit = h.dispute.auditDispute(
        auditor.index,
        real.dispute,
        real.auditingData
    );
    const forgedAudit = h.dispute.auditDispute(
        auditor.index,
        forged.dispute,
        forged.auditingData
    );
    realAudit.catch(() => undefined);
    forgedAudit.catch(() => undefined);
    try {
        await held.waitUntilHeld([String(realLast), String(forgedLast)]);
        await held.release(String(forgedFirst ? forgedLast : realLast));
        await (forgedFirst ? forgedAudit : realAudit);
        await held.release(String(forgedFirst ? realLast : forgedLast));
        const loser = await (forgedFirst ? realAudit : forgedAudit);
        expect(loser.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        const proof = Codec.decode(
            loser.storedProof!.encodedProof,
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        expect(
            await h.channelManager.isDisputeConflictingWithFinalState.staticCall(
                forgedFirst ? real.dispute : forged.dispute,
                proof
            )
        ).to.equal(true);
        expect(
            await h.control(auditor).query.getNextBlockHeight(forkId).request()
        ).to.equal(2);
        expect(
            await h.control(auditor).query.getBlockHashAt(forkId, 2).request()
        ).to.equal(
            Block.fromBlockConfirmation(
                (forgedFirst
                    ? forged.dispute
                    : real.dispute
                ).input.stateProof.milestones.at(-1)!.blockConfirmations[0]
            ).hash
        );
    } finally {
        await held.restore();
        await Promise.allSettled([realAudit, forgedAudit]);
    }
}
