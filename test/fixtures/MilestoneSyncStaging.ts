// @spec-test-coverage-ignore: milestone-only sync and reconstruction staging exercised by explicit E2E declarations
import { readMathPeer } from "./OffChainPromotionFixture";
import { runtimeIsClosed } from "./RuntimeRootObservation";
import { Block, StateSnapshot } from "@/models";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Status, type SyncPayload } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { latestSyncFromResponderBehindDerivedFork } from "@test/fixtures/BotConnectionFixesStaging";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import type { HarnessControlRpcShape } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { StateProofVerification } from "@test/fixtures/customRpc/harnessControl/services/query/QueryRpcMethods";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathTestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

export const encodePayload = (payload: SyncPayload) =>
    Codec.encode(payload, Type.SyncPayload) as string;

/** The heights of each milestone's blocks. */
export function proofHeights(payload: SyncPayload): number[][] {
    return payload.stateProof.milestones.map((milestone) =>
        milestone.blockConfirmations.map(
            (confirmation) => Block.fromBlockConfirmation(confirmation).height
        )
    );
}

/** The first block height of each milestone of a proof projection. */
export function milestoneStarts(proof: StateProofVerification): number[] {
    return proof.milestoneConfirmationHeights.map((heights) => heights[0]);
}

export async function chainSnapshot(h: MathPeerTestHarness) {
    return StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
}

export async function latestHeight(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId
): Promise<number> {
    const height = await h
        .control(peer)
        .query.getLatestBlockHeight(forkId)
        .request();
    if (height === null) throw new Error(`Peer ${peer.index} holds no block`);
    return height;
}

/** The snapshot hash the peer's stored block at `height` commits to. */
export async function committedSnapshotHash(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId,
    height: number
): Promise<string> {
    const bundle = await h
        .control(peer)
        .query.getBlockByHeight(forkId, height)
        .request();
    if (!bundle)
        throw new Error(`Peer ${peer.index} holds no block at ${height}`);
    return bundle.stateSnapshotHash;
}

/**
 * The proof the peer reconstructs from its own storage (its real
 * `buildStateProof` at its head) and the chain's walk of it.
 */
export async function reconstructedProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId = h.activeForkId!
): Promise<StateProofVerification> {
    const proof = await h
        .control(h.getPeer(peerIndex))
        .query.getStateProofVerification(forkId)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    if (!proof)
        throw new Error(`Peer ${peerIndex} has no genesis for fork ${forkId}`);
    return proof;
}

/**
 * The dispute the peer constructs (its real `constructDispute`) and whether
 * the chain accepts its proof with its auditing data.
 */
export async function constructedDisputeOnChain(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId = h.activeForkId!
) {
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        peerIndex,
        forkId
    );
    return {
        verified: await chainAcceptsDisputeProof(
            h.channelManager,
            dispute,
            auditingData
        ),
        milestoneStarts: dispute.input.stateProof.milestones.map(
            (milestone) =>
                Block.fromBlockConfirmation(milestone.blockConfirmations[0])
                    .height
        )
    };
}

/** The responder's payload for its head, built by its real generator. */
export async function servedPayload(
    h: MathPeerTestHarness,
    responder: Peer,
    forkId: ForkId
): Promise<SyncPayload> {
    const served = await h
        .control(responder)
        .spectate.generateSyncPayload(
            h.channelId,
            forkId,
            await latestHeight(h, responder, forkId)
        )
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    expect(served, "the responder serves a payload").to.not.equal(null);
    return Codec.decode(served!.encodedSyncPayload, Type.SyncPayload);
}

/**
 * One real sync of `requester` toward `responder`, pinned to `forkId` at
 * `blockHeight`. Returns the verdict, the requester's rejection reasons,
 * whether it blacklisted the responder, and its head after.
 */
export async function syncFromResponder(
    h: MathPeerTestHarness,
    requester: Peer,
    responder: Peer,
    forkId: ForkId,
    blockHeight: number
) {
    const control = h.control(requester);
    await control.stub.recordSyncRejections().request();
    try {
        const synced = await control.spectate
            .sync(responder.address, forkId, blockHeight)
            .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
        return {
            synced,
            rejections: await control.stub
                .restoreRecordedSyncRejections()
                .request(),
            blacklisted: await control.query
                .isBlacklisted(responder.address)
                .request(),
            latestHeight: await control.query
                .getLatestBlockHeight(forkId)
                .request()
        };
    } finally {
        await control.stub.restoreRecordedSyncRejections().request();
    }
}

/** {@link syncFromResponder} while `responder` answers with `encodedSyncPayload`. */
export async function syncFromServedPayload(
    h: MathPeerTestHarness,
    requester: Peer,
    responder: Peer,
    encodedSyncPayload: string,
    forkId: ForkId,
    blockHeight: number
) {
    await h
        .control(responder)
        .stub.stubSpectatePayload(encodedSyncPayload)
        .request();
    try {
        return await syncFromResponder(
            h,
            requester,
            responder,
            forkId,
            blockHeight
        );
    } finally {
        await h.control(responder).stub.restoreSpectateStaleProof().request();
    }
}

/** Heights in `[from, to]` the peer holds no block at. */
export async function missingBlockHeights(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId,
    from: number,
    to: number
): Promise<number[]> {
    const missing: number[] = [];
    for (let height = from; height <= to; height++)
        if (
            (await h
                .control(peer)
                .query.getBlockHashAt(forkId, height)
                .request()) === null
        )
            missing.push(height);
    return missing;
}

/** Both peers hold an open connection to each other. */
export async function waitForMutualConnection(
    h: MathPeerTestHarness,
    a: Peer,
    b: Peer
): Promise<void> {
    await waitFor(
        async () =>
            (await h.control(a).query.isConnectedTo(b.address).request()) &&
            (await h.control(b).query.isConnectedTo(a.address).request()),
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * A spectator synced at the channel genesis, before block 0, that drops
 * every network-delivered block and ignores calldata-posted blocks: it
 * learns blocks only through an explicit sync. Its local diamond keeps
 * following the chain's events.
 */
export async function addSyncOnlyObserverAtGenesis(
    h: MathPeerTestHarness
): Promise<Peer> {
    // Spawn-only: no block exists yet, so no authoring window is spent.
    const observer = h.getPeer((await h.join.addSpectatorWait()).index);
    await h.rpcStub.dropNetworkConfirmations(observer.index);
    await h.byzantine.stubCalldataHandler(observer.index);
    return observer;
}

/**
 * Two founders, optionally a sync-only observer, then a spectator joins
 * through `joinChannel`; its promotion block is the participant change.
 * `postPromotionBlocks` final blocks follow. Returns the participants, the
 * change height and the head.
 */
export async function stagePromotedChannel(
    h: MathPeerTestHarness,
    options: {
        postPromotionBlocks: number;
        syncOnlyObserver?: boolean;
    }
) {
    await h.lifecycle.start(2, 0);
    // `keepOnlyAuthorSignatures` settles the confirmations the founders admit.
    for (const peer of h.peers)
        await h.control(peer).stub.recordConfirmationOperations().request();
    const observer = options.syncOnlyObserver
        ? await addSyncOnlyObserverAtGenesis(h)
        : undefined;
    const { peer: joiner } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 18,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({
        peerIndices: [0, 1, joiner.index]
    });
    await h.join.joinChannelWait({ joiner });
    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [joiner.index],
        status: Status.PARTICIPATING,
        waitForPeers: [0, 1],
        maximumBlocks: 20
    });
    const participants = [0, 1, joiner.index];
    if (options.postPromotionBlocks > 0)
        await h.transition.advanceState({
            count: options.postPromotionBlocks,
            waitForPeers: participants,
            waitForFinalization: true
        });
    await h.assert.sync.peersInSyncWait({ peerIndices: participants });
    const forkId = h.activeForkId!;
    const changeHeight = (
        await h
            .control(h.getPeer(0))
            .query.getParticipantChangeHeights(forkId)
            .request()
    ).at(-1);
    if (changeHeight === undefined)
        throw new Error("The promotion recorded no participant change");
    return {
        forkId,
        participants,
        joiner: h.getPeer(joiner.index),
        observer,
        changeHeight,
        tip: await latestHeight(h, h.getPeer(0), forkId)
    };
}

/**
 * Replace the peer's stored blocks at `heights` with author-signed copies:
 * the threshold evidence of those blocks then comes only from the authors of
 * the blocks linked after them (virtual voting). The peer first stops
 * ingesting gossiped confirmations: a confirmation still in flight would
 * merge the removed signatures back. The confirmation operations the peer
 * admitted before that settle next, and the strip runs once after them. The
 * peer records its confirmation operations since before these blocks'
 * confirmations arrived (`stagePromotedChannel` records on the founders).
 */
export async function keepOnlyAuthorSignatures(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    heights: number[]
): Promise<void> {
    const peer = h.getPeer(peerIndex);
    await h.rpcStub.dropNetworkConfirmations(peerIndex);
    const blockHashes: Hash[] = [];
    for (const height of heights) {
        const blockHash = await h
            .control(peer)
            .query.getBlockHashAt(forkId, height)
            .request();
        if (blockHash === null) throw new Error(`No stored block at ${height}`);
        blockHashes.push(blockHash);
    }
    await h
        .control(peer)
        .stub.settleConfirmationOperations(blockHashes)
        .request();
    await h.execOnHost(
        peer,
        async (sm, args) => {
            const blocks = sm.storage.blocks;
            for (const height of args.heights) {
                const block = blocks.getBlock(args.forkId, height);
                if (!block) throw new Error(`No stored block at ${height}`);
                // a queued copy would merge its signatures back later
                if (sm.storage.queues.getQueuedEntry(block.hash))
                    throw new Error(`A copy of block ${height} is queued`);
                blocks.deleteBlock(args.forkId, height);
                blocks.storeBlock(block.authorSignedCopy());
            }
        },
        { forkId, heights }
    );
}

/**
 * `stagePromotedChannel` with three final blocks after the promotion, then
 * peer 0 keeps only author signatures from the change block to its head. The
 * change hop is then proven by the authors of the blocks after it, and the
 * backward search proves a later final point whose support run overlaps the
 * change run. The participants stop running writer-timeout checks, so the
 * idle channel can be inspected. Returns peer 0's reconstructed proof.
 */
export async function stageOverlappingSupport(
    h: MathPeerTestHarness,
    options: { syncOnlyObserver: boolean }
) {
    const staged = await stagePromotedChannel(h, {
        postPromotionBlocks: 3,
        syncOnlyObserver: options.syncOnlyObserver
    });
    const { forkId, changeHeight, tip } = staged;
    for (const index of staged.participants)
        await h.rpcStub.suppressTimeoutCheck(index);
    await keepOnlyAuthorSignatures(
        h,
        0,
        forkId,
        Array.from(
            { length: tip - changeHeight + 1 },
            (_, offset) => changeHeight + offset
        )
    );
    const proof = await reconstructedProof(h, 0, forkId);
    const runs = proof.milestoneConfirmationHeights;
    const changeRun = runs.at(-2);
    const lastRun = runs.at(-1)!;
    expect(changeRun?.[0], "the change hop is a milestone").to.equal(
        changeHeight
    );
    expect(lastRun[0], "a later final point").to.be.greaterThan(changeHeight);
    expect(
        changeRun!.at(-1),
        "the change run supports the later final point and its tail"
    ).to.be.greaterThan(lastRun[0]);
    return { ...staged, responder: h.getPeer(0), proof };
}

/**
 * The served overlapping payload with its first tail block (the block after
 * the last milestone's final point, also part of the change run) re-signed
 * by its author over the final point's snapshot: an invalid transition the
 * walk cannot see. Every later tail block is re-linked and re-signed by its
 * author, in both runs, so the walk still accepts the proof.
 */
export async function forgeRepeatedTailTransition(
    h: MathPeerTestHarness,
    payload: SyncPayload
): Promise<SyncPayload> {
    const forged = Codec.decode(encodePayload(payload), Type.SyncPayload);
    const milestones = forged.stateProof.milestones;
    const lastRun = milestones.at(-1)!.blockConfirmations;
    const changeRun = milestones.at(-2)!.blockConfirmations;
    const finalPoint = Block.fromBlockConfirmation(lastRun[0]);
    const signerOf = (address: string) => {
        const peer = h.peers.find((candidate) => candidate.address === address);
        if (!peer) throw new Error(`No harness signer for ${address}`);
        return peer.signer;
    };
    const replaced = new Map<string, BlockConfirmationStruct>();
    let previousHash = finalPoint.hash;
    for (const [index, confirmation] of lastRun.entries()) {
        if (index === 0) continue;
        const original = Block.fromBlockConfirmation(confirmation);
        const struct = Codec.decode(original.encode(), Type.Block);
        struct.previousBlockHash = previousHash;
        if (index === 1)
            struct.stateSnapshotHash = finalPoint.stateSnapshotHash;
        const resigned = await Block.fromBlockStruct(
            struct,
            signerOf(String(original.author))
        );
        replaced.set(String(original.hash), {
            signedBlock: resigned.signedBlock,
            signatures: []
        });
        previousHash = resigned.hash;
    }
    const repeated = Block.fromBlockConfirmation(lastRun[1]).hash;
    expect(
        changeRun.some(
            (confirmation) =>
                Block.fromBlockConfirmation(confirmation).hash === repeated
        ),
        "the forged tail block repeats in the change run"
    ).to.equal(true);
    for (const milestone of milestones)
        milestone.blockConfirmations = milestone.blockConfirmations.map(
            (confirmation) =>
                replaced.get(
                    String(Block.fromBlockConfirmation(confirmation).hash)
                ) ?? confirmation
        );
    return forged;
}

/**
 * Every peer in `servers` answers spectate requests with
 * `encodedSyncPayload` while a fresh spectator runs its real initial sync.
 * Waits for the spectator's abort; returns whether its runtime closed and
 * the statuses it moved to. The peers serve honestly again after.
 */
export async function freshSpectatorStopsOnPayload(
    h: MathPeerTestHarness,
    encodedSyncPayload: string,
    servers: number[]
) {
    const stubs = servers.map((index) => h.control(h.getPeer(index)).stub);
    try {
        for (const stub of stubs)
            await stub.stubSpectatePayload(encodedSyncPayload).request();
        const spectator = await h.join.addSpectator();
        // The tail replay meets the forged transition after the sync already
        // set SYNCED: the spectating strategy aborts the participation, so
        // the connect itself does not fail.
        await h.event.waitForPeers("onAbort", [spectator.index], 1);
        await waitFor(
            () => runtimeIsClosed(spectator.p2pInstance),
            h.event.protocolEventTimeoutMs()
        );
        await MathTestSession.settleDetached();
        return {
            closed: runtimeIsClosed(spectator.p2pInstance),
            // each status the spectator moved to, in order
            statuses: (
                spectator.eventSpies.onStatusChanged?.getCalls() ?? []
            ).map((call) => call.args[1] as Status)
        };
    } finally {
        for (const stub of stubs)
            await stub.restoreSpectateStaleProof().request();
    }
}

/**
 * Every peer in `servers` answers spectate requests with the sync payload
 * while a fresh spectator runs its real initial sync to SYNCED; the peers
 * serve honestly again after. `writers` keep the writer slot alive while the
 * spectator runtime is created (the slow part of a spawn, seconds on a
 * loaded host) and then author one final block, so only the connection and
 * the sync run idle: an idle slot longer than p2pTime + agreementTime gets
 * the next block rejected by the subjective time check. With no writers
 * the spawn runs idle. A function `syncPayload` is read after that block.
 */
export async function syncSpectatorOnServedPayload(
    h: MathPeerTestHarness,
    syncPayload: string | (() => Promise<string>),
    servers: number[],
    writers: number[],
    beforeConnect?: (peer: Peer) => Promise<void>
): Promise<Peer> {
    let created = false;
    const creating = h.join.createSpectatorPeer().finally(() => {
        created = true;
    });
    // observed below; keeps a failure from being an unhandled rejection meanwhile
    creating.catch(() => undefined);
    if (writers.length > 0)
        await h.transition.keepAuthoringUntil({
            until: () => created,
            waitForPeers: writers,
            maximumBlocks: 20
        });
    const spectator = h.getPeer((await creating).index);
    if (writers.length > 0)
        await h.transition.advanceState({
            count: 1,
            waitForPeers: writers,
            waitForFinalization: true
        });
    const encodedSyncPayload =
        typeof syncPayload === "string" ? syncPayload : await syncPayload();
    const stubs = servers.map((index) => h.control(h.getPeer(index)).stub);
    try {
        for (const stub of stubs)
            await stub.stubSpectatePayload(encodedSyncPayload).request();
        await beforeConnect?.(spectator);
        await h.join.connectSpectator(spectator);
        await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED, {
            timeoutMs: h.event.protocolEventTimeoutMs(),
            timeoutMessage: `Spectator peer ${spectator.index} did not reach SYNCED after connect`
        });
        return spectator;
    } finally {
        for (const stub of stubs)
            await stub.restoreSpectateStaleProof().request();
    }
}

/**
 * The peers that write the next `count` blocks, read from the turn index of
 * `observerIndex`'s state machine.
 */
export async function nextWriters(
    h: MathPeerTestHarness,
    observerIndex: number,
    count: number
): Promise<number[]> {
    const { state } = await readMathPeer(h, observerIndex);
    const length = BigInt(state.participants.length);
    return Array.from({ length: count }, (_, offset) => {
        const address =
            state.participants[
                Number((state.currentTurnIndex + BigInt(offset)) % length)
            ];
        const peer = h.peers.find((candidate) => candidate.address === address);
        if (!peer) throw new Error(`No harness peer writes as ${address}`);
        return peer.index;
    });
}

/**
 * `poster` posts its snapshot; returns it once the chain holds it and every
 * peer in `observers` mirrors it locally.
 */
export async function postSnapshotSeenBy(
    h: MathPeerTestHarness,
    posterIndex: number,
    observers: number[],
    forkId: ForkId
): Promise<StateSnapshot> {
    const posted = await h.transition.postSnapshot({
        peerIndex: posterIndex,
        forkId: String(forkId)
    });
    if (!posted) throw new Error(`Peer ${posterIndex} posted no snapshot`);
    await waitFor(async () => {
        if ((await chainSnapshot(h)).hash !== posted.hash) return false;
        for (const index of observers)
            if (
                (await h.query.getLocalStateSnapshot(h.getPeer(index))).hash !==
                posted.hash
            )
                return false;
        return true;
    }, h.event.protocolEventTimeoutMs());
    return posted;
}

/**
 * `stagePromotedChannel` (two final blocks after the change), then peer 0's
 * local diamond stops applying StateSnapshotUpdated logs, peer 1 posts the
 * snapshot of the head (the anchor, above the change), and two more final
 * blocks follow. Peer 0's mirror still has no anchor; the chain and every
 * other mirror do. `release` applies the held logs to peer 0's mirror.
 */
export async function stageLaggingConstructionMirror(h: MathPeerTestHarness) {
    const staged = await stagePromotedChannel(h, { postPromotionBlocks: 2 });
    const { forkId, participants } = staged;
    const held = await h.mirror.holdUpdates(0, "onStateSnapshotUpdated");
    const anchor = await postSnapshotSeenBy(
        h,
        1,
        participants.filter((index) => index !== 0),
        forkId
    );
    expect(anchor.forkID).to.equal(forkId);
    expect(anchor.blockHeight).to.be.greaterThan(staged.changeHeight);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: participants,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: participants });
    // the held snapshot log can be delivered more than once (live and
    // recovered); the mirror itself must not hold the anchor
    expect(await held.heldCount()).to.be.greaterThan(0);
    expect(
        (await h.query.getLocalStateSnapshot(h.getPeer(0))).hash,
        "peer 0's mirror lags"
    ).to.not.equal(anchor.hash);
    return {
        ...staged,
        anchor,
        tip: await latestHeight(h, h.getPeer(0), forkId),
        release: held.release
    };
}

/**
 * Four peers; two final blocks, a fully signed leave, then two final blocks
 * by the remaining participants. The leaver's snapshot posts
 * (`exit snapshot post`) are recorded and never run, so no exit snapshot is
 * posted: the chain snapshot stays the genesis.
 */
export async function stageUnpostedLeave(h: MathPeerTestHarness) {
    await h.lifecycle.start(4, 0);
    await h.transition.advanceState({ count: 2 });
    const leaverIndex = (await h.query.getNextPeerToWrite()).index;
    await h.rpcStub.recordScheduledTasks(leaverIndex, {
        suppressPrefix: "exit snapshot post"
    });
    await h.transition.participantLeaveStateTransition({ leaverIndex });
    const remaining = [0, 1, 2, 3].filter((index) => index !== leaverIndex);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: remaining,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: remaining });
    expect((await chainSnapshot(h)).isGenesis, "exit unposted").to.equal(true);
    const forkId = h.activeForkId!;
    const changeHeight = (
        await h
            .control(h.getPeer(remaining[0]))
            .query.getParticipantChangeHeights(forkId)
            .request()
    ).at(-1);
    if (changeHeight === undefined)
        throw new Error("The leave recorded no participant change");
    return { forkId, leaverIndex, remaining, changeHeight };
}

/**
 * Prune the peer's history below `anchorHeight` with the test-harness
 * prunes: first the snapshots and application states of the blocks below
 * it, then those blocks. The anchor block, its snapshot and state, and the
 * fork genesis stay. Returns the pruned block heights and snapshot hashes.
 */
export async function pruneBelowAnchor(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId,
    anchorHeight: number
) {
    const stub = h.control(peer).stub;
    const { prunedSnapshotHashes } = await stub
        .pruneStoredSnapshotsBelowAnchor(forkId, anchorHeight)
        .request();
    const { prunedHeights } = await stub
        .pruneStoredBlocksBelowAnchor(forkId, anchorHeight)
        .request();
    return { prunedHeights, prunedSnapshotHashes };
}

/**
 * A fresh spectator runs its real initial sync on the payload `served`
 * builds at its head: every peer in `servers` answers with it. The writers
 * in `writers` stop running writer-timeout checks for the rest of the test,
 * so an idle writer slot never opens a timeout dispute. By default
 * the spawn runs idle and the payload is the head at the call, for a caller
 * that authors no block afterwards. With `authorThroughCreation` the writers
 * keep authoring through the spectator's creation and author one final
 * block, so a caller that authors afterwards finds the writer slot alive;
 * the head then moves past its height at the call.
 * Returns the spectator once SYNCED.
 */
export async function freshSpectatorSyncedFrom(
    h: MathPeerTestHarness,
    served: Peer,
    servers: number[],
    writers: number[],
    forkId: ForkId,
    options: { authorThroughCreation?: boolean } = {}
): Promise<Peer> {
    for (const index of writers) await h.rpcStub.suppressTimeoutCheck(index);
    if (!options.authorThroughCreation)
        return syncSpectatorOnServedPayload(
            h,
            encodePayload(await servedPayload(h, served, forkId)),
            servers,
            []
        );
    return syncSpectatorOnServedPayload(
        h,
        async () => {
            await h.assert.sync.peersInSyncWait({
                peerIndices: [...new Set([...writers, served.index])]
            });
            return encodePayload(await servedPayload(h, served, forkId));
        },
        servers,
        writers
    );
}

/**
 * Waits until the peer's reconstruction starts at the chain's snapshot (its
 * local diamond mirrored the adoption); returns that reconstruction.
 */
export async function reconstructionFromChainAnchor(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<StateProofVerification> {
    const anchorHash = (await chainSnapshot(h)).hash;
    let proof: StateProofVerification | undefined;
    await waitFor(async () => {
        proof = await reconstructedProof(h, peerIndex, forkId);
        return proof.startSnapshotHash === anchorHash;
    }, h.event.protocolEventTimeoutMs());
    return proof!;
}

/**
 * A spectator syncs while two founders author, joins, is admitted and keeps
 * authoring; then peer 0 posts a snapshot and one more final block follows.
 * Returns the spectator's reconstruction at each stage: synced, pending,
 * participating, after progress, after the anchor moved.
 */
export async function stageSyncedThroughParticipation(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0);
    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 18,
        waitForFinalization: true
    });
    const member = h.getPeer(peer.index);
    await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, member.index] });
    const forkId = h.activeForkId!;
    const synced = await reconstructedProof(h, member.index, forkId);

    await h.join.joinChannelWait({ joiner: member });
    const status = await h.control(member).query.getStatus().request();
    const pending = await reconstructedProof(h, member.index, forkId);

    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [member.index],
        status: Status.PARTICIPATING,
        waitForPeers: [0, 1],
        maximumBlocks: 20
    });
    const participants = [0, 1, member.index];
    await h.assert.sync.peersInSyncWait({ peerIndices: participants });
    const joinHeight = (
        await h
            .control(member)
            .query.getParticipantChangeHeights(forkId)
            .request()
    ).at(-1);
    const participating = await reconstructedProof(h, member.index, forkId);

    await h.transition.advanceState({
        count: 2,
        waitForPeers: participants,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: participants });
    const progressed = await reconstructedProof(h, member.index, forkId);

    // Publishing the anchor must not stop normal authoring while its chain
    // event reaches every local mirror.
    let published = false;
    const publishing = h.transition
        .postSnapshotWait({ peerIndex: 0, forkId: String(forkId) })
        .finally(() => {
            published = true;
        });
    const [anchor] = await Promise.all([
        publishing,
        h.transition.keepAuthoringUntil({
            until: () => published,
            waitForPeers: participants,
            maximumBlocks: 20
        })
    ]);
    if (!anchor) throw new Error("No snapshot posted");
    await h.transition.advanceState({
        count: 1,
        waitForPeers: participants,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: participants });
    const anchored = await reconstructionFromChainAnchor(
        h,
        member.index,
        forkId
    );
    return {
        forkId,
        member,
        participants,
        status,
        joinHeight,
        anchor,
        stages: { synced, pending, participating, progressed, anchored }
    };
}

/**
 * A disputed fork whose reduction is computed but whose successor genesis
 * peer 0 has not installed (held at its `setState`), so its local state
 * lags the fork the chain's windows derive. Participant 2 sends a
 * latest-state request (no fork) to peer 0. Returns the requester's fork
 * after the sync and both blacklist verdicts, then releases the hold.
 */
export async function syncLatestFromUninstalledSuccessor(
    h: MathPeerTestHarness
) {
    const result = await latestSyncFromResponderBehindDerivedFork(h);
    return {
        sourceForkId: result.sourceForkId,
        responderFork: result.responderOwnFork,
        requesterFork: result.observerForkId,
        requesterBlacklistedResponder: result.observerBlacklistedResponder,
        responderBlacklistedRequester: result.responderBlacklistedObserver
    };
}

/**
 * A fresh spectator spawns while the honest participants author. Before it
 * connects, it records its syncs (each still runs) and every pair between it
 * and `honest` or `firstIndex` is blacklisted both ways, so it can only cache
 * the chain snapshot, and its mirror applies no on-chain slash (held). Then
 * `firstIndex` handshakes, as the spectator's first
 * peer; its mirror and chain answers are read at that point. With `adopt`,
 * the spectator's mirror stops applying snapshot updates while `adopt` then
 * moves the chain snapshot, and catches up after it. The honest pairs are
 * lifted last, and the spawn runs to SYNCED. Returns the spectator and the
 * answers at the first handshake.
 */
export async function spawnSpectatorAfterFirstHandshake(
    h: MathPeerTestHarness,
    firstIndex: number,
    honest: number[],
    adopt?: () => Promise<void>
) {
    const channelId = h.channelId.toString();
    const first = h.getPeer(firstIndex);
    const setPairs = async (
        spectator: Peer,
        indices: number[],
        blacklisted: boolean
    ) => {
        for (const index of indices) {
            const peer = h.getPeer(index);
            const pair: [Peer, string][] = [
                [spectator, peer.address],
                [peer, spectator.address]
            ];
            for (const [from, address] of pair) {
                const network = h.control(from).network;
                await (
                    blacklisted
                        ? network.blacklistAndDisconnectPeerByAddress(address)
                        : network.unblacklistPeerByAddress(address)
                ).request();
            }
        }
    };
    const rejoin = async (spectator: Peer) => {
        await h
            .control(spectator)
            .network.leaveSelectedKey(channelId)
            .request();
        await h.network.joinSelectedKey([spectator.index], channelId);
    };
    const answers = async (spectator: Peer) => ({
        mirrorParticipant: await h.execOnHost(
            spectator,
            async (sm, a) =>
                sm.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                    sm.channelId,
                    a.address
                ),
            { address: first.address }
        ),
        chainParticipant: await h.channelManager.canParticipateInDisputes(
            h.channelId,
            first.address
        ),
        chainSlashed: await h.channelManager.isParticipantSlashedOnChain(
            h.channelId,
            first.address
        )
    });
    let created: Peer | undefined;
    let releaseSlashes: (() => Promise<number>) | undefined;
    const spawn = h.join.addSpectatorAuthoring({
        authoringPeerIndices: honest,
        minimumBlocks: 1,
        maximumBlocks: 20,
        waitForFinalization: true,
        beforeConnect: async (peer) => {
            const spectator = h.getPeer(peer.index);
            await h.rpcStub.recordSpectateSync(spectator.index, {
                forward: true
            });
            await setPairs(spectator, [...honest, firstIndex], true);
            // the mirror learns no slash until the first handshake was read
            releaseSlashes = (
                await h.mirror.holdUpdates(
                    spectator.index,
                    "onOnChainSlashAdded"
                )
            ).release;
            created = spectator;
        }
    });
    // OPENED follows the mirror caching the chain snapshot
    await waitFor(
        async () =>
            !!created &&
            (await h.control(created).query.getStatus().request()) !==
                Status.NOT_OPENED,
        h.event.protocolEventTimeoutMs()
    );
    const spectator = created!;
    const beforeAdoption = await answers(spectator);
    const held = adopt
        ? await h.mirror.holdUpdates(spectator.index, "onStateSnapshotUpdated")
        : undefined;
    await setPairs(spectator, [firstIndex], false);
    await rejoin(spectator);
    await waitFor(
        async () =>
            await h
                .control(spectator)
                .query.isConnectedTo(first.address)
                .request(),
        h.event.protocolEventTimeoutMs()
    );
    const atFirstHandshake = await answers(spectator);
    // after the first handshake: an adoption removes a slashed first peer,
    // whose own runtime then aborts
    await adopt?.();
    await held?.release();
    await releaseSlashes!();
    await setPairs(spectator, honest, false);
    await rejoin(spectator);
    await spawn;
    return { spectator, beforeAdoption, atFirstHandshake };
}

/**
 * Restart the peer at `index`: its runtime and logger are disposed and a new
 * runtime for the same signer is created at the same index, with empty
 * in-memory storage, and dispatched to the channel. The caller drives its
 * initial sync to SYNCED.
 */
export async function restartPeerRuntime(
    h: MathPeerTestHarness,
    index: number,
    authoringPeerIndices: number[]
): Promise<Peer> {
    const previous = h.getPeer(index);
    const wasAfk = h.context.afkPeerIndices.includes(index);
    h.contextApi.markAfkPeer({ afkPeerIndex: index });
    let ready = false;
    const restarting = (async () => {
        await previous.p2pInstance.dispose();
        previous.logger.dispose();
        await h.createPeer(index, previous.signer);
        const restarted = h.getPeer(index);
        await h.join.connectSpectator(restarted);
        return restarted;
    })().finally(() => {
        ready = true;
    });
    try {
        // Runtime recreation must not consume the participants' writer window.
        // The unavailable old runtime is excluded from harness state queries.
        const [restarted] = await Promise.all([
            restarting,
            h.transition.keepAuthoringUntil({
                until: () => ready,
                waitForPeers: authoringPeerIndices,
                maximumBlocks: 20
            })
        ]);
        return restarted;
    } finally {
        if (!wasAfk)
            h.context.afkPeerIndices = h.context.afkPeerIndices.filter(
                (peerIndex) => peerIndex !== index
            );
    }
}

/**
 * `stageReducibleDisputedFork` (peer 1 slashed): `reducers` get their
 * reduction tasks back and reduce onto the successor while the successor's
 * writers keep authoring. Every adopt-only post of a reducer fails until
 * `releaseAdoption` (each reducer posts once and retries once on its own),
 * so the chain snapshot stays on the source fork and still lists the
 * slashed peer however late a retry runs. Those failures are expected
 * detached errors. Returns the forks and `releaseAdoption`, which restores
 * the real posts.
 */
export async function stageReducedWithoutAdoption(
    h: MathPeerTestHarness,
    reducers: number[]
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const honest = [0, 2, 3];
    const adoptions = await Promise.all(
        reducers.map((index) =>
            h.rpcStub.failFirstAdoptionPost(index, Number.MAX_SAFE_INTEGER)
        )
    );
    for (const index of reducers)
        await h
            .control(h.getPeer(index))
            .stub.restoreReductionTasks(true)
            .request();
    await h.assert.sync.forkChangedWait({
        originalForkId: sourceForkId,
        honestPeerIndices: honest
    });
    const successor = h.activeForkId!;
    const adoptOnly = (names: string[]) =>
        names.length === 1 && names[0] === "updateStateSnapshotFork";
    // the reduce landed: its submitter attempted the adoption
    await h.transition.keepAuthoringUntil({
        until: async () => {
            for (const adoption of adoptions)
                if ((await adoption.recorded()).some(adoptOnly)) return true;
            return false;
        },
        waitForPeers: honest,
        maximumBlocks: 20
    });
    // every failed adopt-only post, now or from a later retry, is expected
    await MathTestSession.expectFirstDetachedError({
        includes: "injected adoption post send failure",
        required: false
    });
    expect((await chainSnapshot(h)).forkID).to.equal(sourceForkId);
    return {
        sourceForkId,
        successor,
        honest,
        releaseAdoption: async () => {
            for (const adoption of adoptions) await adoption.restore();
        }
    };
}

/**
 * The spectator's recorded syncs never targeted `skipped`, its first one
 * went to an honest participant, and it reached SYNCED on `forkId` without
 * an abort.
 */
export async function expectInitialSyncSkipped(
    h: MathPeerTestHarness,
    spectator: Peer,
    skipped: Peer,
    honest: number[],
    forkId: ForkId
): Promise<void> {
    const targets = await h.rpcStub.spectateSyncTargetsWait(
        spectator.index,
        await h.rpcStub.spectateSyncCallCount(spectator.index)
    );
    expect(targets.length).to.be.greaterThan(0);
    expect(targets).to.not.include(skipped.address);
    expect(honest.map((index) => h.getPeer(index).address)).to.include(
        targets[0]
    );
    expect(spectator.eventSpies.onAbort?.called ?? false).to.equal(false);
    expect(await h.control(spectator).query.getStatus().request()).to.equal(
        Status.SYNCED
    );
    expect(await h.control(spectator).query.getForkId().request()).to.equal(
        forkId
    );
}

/**
 * Participants 0 and 1 open the channel and participant 0 joins its key;
 * participant 1 then restarts with a fresh runtime that has not connected.
 */
async function restartSecondParticipant(h: MathPeerTestHarness) {
    await h.setup(2, { autoConnect: false });
    return await openAndRestartSecondParticipant(h);
}

/** {@link restartSecondParticipant} on a harness whose two peers are set up. */
async function openAndRestartSecondParticipant<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(h: PeerTestHarness<THost, MathStateMachine>) {
    await h.lifecycle.openChannelForParticipants([0, 1]);
    await h.network.joinSelectedKey([0], String(h.channelId));
    const participant = h.getPeer(0);
    const founder = h.getPeer(1);
    await founder.p2pInstance.dispose();
    founder.logger.dispose();
    await h.createPeer(1, founder.signer);
    return { participant, responder: h.getPeer(1) };
}

/** A fresh observer whose pairs with `participant` are blacklisted both ways. */
async function createObserverIsolatedFrom<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    participant: TestPeer<THost, MathStateMachine>
) {
    const observerIndex = h.peers.length;
    await h.createPeer(
        observerIndex,
        h.signerFor(slotAccountIndex(observerIndex))
    );
    const observer = h.getPeer(observerIndex);
    for (const [from, to] of [
        [observer, participant],
        [participant, observer]
    ])
        await h
            .control(from)
            .network.blacklistAndDisconnectPeerByAddress(to.address)
            .request();
    return observer;
}

/** The observer's recorded sync results, targets and timings. */
async function observerSyncs(h: MathPeerTestHarness, observer: Peer) {
    const settles = await h.rpcStub.spectateSyncSettles(observer.index);
    return {
        syncResults: settles.map((settle) => settle.result),
        syncTargets: await h.rpcStub.spectateSyncTargetsWait(observer.index, 1),
        // from the first (still-syncing) answer to the next request
        nextRequestDelayMs:
            settles.length > 1
                ? settles[1].startedAt - settles[0].settledAt
                : undefined
    };
}

/**
 * Participants 0 and 1 open the channel; participant 1 then restarts with a
 * fresh runtime and connects, so its own initial sync runs from participant
 * 0. That sync is held at its application step, and participant 1 stays
 * OPENED. A fresh observer whose pairs with participant 0 are blacklisted
 * both ways reaches only participant 1, its first chain-eligible handshake,
 * and its initial sync request reaches participant 1 while it is OPENED.
 * Then the held sync is released: applied (`success`), failed (`failure`),
 * or applied only after the observer's connect settled
 * (`afterObserverConnect`). Returns the observer, both connect results, the
 * observer's sync results, targets and the delay of its next request, the
 * window, and participant 1's status when the first request arrived.
 */
export async function syncFromSyncingParticipant(
    h: MathPeerTestHarness,
    outcome: "success" | "failure" | "afterObserverConnect"
) {
    const { participant, responder } = await restartSecondParticipant(h);
    const observer = await createObserverIsolatedFrom(h, participant);
    await h.rpcStub.recordSpectateSync(observer.index, { forward: true });
    await h.rpcStub.stubCountSpectateRequests(responder.index);
    const held = await h.rpcStub.holdSpectateSyncApplication(
        responder.index,
        participant.index,
        outcome === "failure"
    );
    const windowMs = await h.execOnHost(
        participant,
        async (sm) => sm.timeConfig.agreementTime * 1000
    );
    // a failed application aborts both runtimes: release only once
    let released = false;
    try {
        const responderConnect =
            responder.p2pInstance.p2pSigner.connectToChannel(h.channelId);
        await waitFor(
            async () => (await held.entered()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        const observerConnect = observer.p2pInstance.p2pSigner.connectToChannel(
            h.channelId
        );
        await waitFor(
            async () =>
                (await h.rpcStub.getSpectateRequestCount(responder.index)) >= 1,
            h.event.protocolEventTimeoutMs()
        );
        const responderStatusAtRequest = await h
            .control(responder)
            .query.getStatus()
            .request();
        // The observer aborts at its deadline, and its abort disposes its
        // runtime: read its records, once its first answer settled, while it
        // still runs.
        let syncsBeforeAbort:
            | Awaited<ReturnType<typeof observerSyncs>>
            | undefined;
        if (outcome === "afterObserverConnect") {
            await waitFor(
                async () =>
                    (await h.rpcStub.spectateSyncSettles(observer.index))
                        .length >= 1,
                h.event.protocolEventTimeoutMs()
            );
            syncsBeforeAbort = await observerSyncs(h, observer);
        }
        const connectBeforeRelease =
            outcome === "afterObserverConnect"
                ? await observerConnect
                : undefined;
        released = true;
        await held.release();
        const responderConnected = await responderConnect;
        const observerConnected =
            connectBeforeRelease ?? (await observerConnect);
        return {
            participant,
            responder,
            observer,
            windowMs,
            responderStatusAtRequest,
            ...(syncsBeforeAbort ?? (await observerSyncs(h, observer))),
            responderConnected,
            observerConnected
        };
    } finally {
        if (!released) await held.release();
    }
}

/**
 * {@link openAndRestartSecondParticipant} with participant 0's timeout check
 * suppressed, so the idle channel opens no dispute. The restarted
 * participant 1 connects and its own initial sync from participant 0 is
 * held at its application step, so it stays OPENED and answers every sync
 * request at once that it is still syncing. Participant 1's sync is
 * released after `run`. Returns `run`'s result and participant 1's connect
 * result.
 */
async function withSyncingSecondParticipant<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>,
    T
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    run: (staged: {
        participant: TestPeer<THost, MathStateMachine>;
        responder: TestPeer<THost, MathStateMachine>;
    }) => Promise<T>
): Promise<{ result: T; responderConnected: boolean }> {
    const { participant, responder } = await openAndRestartSecondParticipant(h);
    const restoreTimeoutCheck = await h.rpcStub.suppressTimeoutCheck(
        participant.index
    );
    const held = await h.rpcStub.holdSpectateSyncApplication(
        responder.index,
        participant.index
    );
    let released = false;
    try {
        const responderConnect =
            responder.p2pInstance.p2pSigner.connectToChannel(h.channelId);
        await waitFor(
            async () => (await held.entered()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        const result = await run({ participant, responder });
        released = true;
        await held.release();
        return { result, responderConnected: await responderConnect };
    } finally {
        if (!released) await held.release();
        await restoreTimeoutCheck();
    }
}

/**
 * {@link withSyncingSecondParticipant}: `run` gets a fresh observer, not yet
 * connected, whose pairs with participant 0 are blacklisted both ways, so
 * the still-syncing participant 1 is the only participant it reaches.
 */
export async function withObserverOfSyncingParticipant<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    run: (staged: {
        observer: TestPeer<THost, MathStateMachine>;
        responder: TestPeer<THost, MathStateMachine>;
    }) => Promise<void>
): Promise<void> {
    const { responderConnected } = await withSyncingSecondParticipant(
        h,
        async ({ participant, responder }) => {
            const observer = await createObserverIsolatedFrom(h, participant);
            await run({ observer, responder });
        }
    );
    expect(responderConnected).to.equal(true);
}

/**
 * Participant 0 asks the still-syncing participant 1 of
 * {@link withSyncingSecondParticipant} for one target from four callers at
 * once: one `requestSync` and three `syncBlockSource` calls, which share one
 * request. Participant 1 holds its still-syncing answer until all four wait.
 * Returns the four results, participant 1's answered request count, and
 * participant 0's strikes on and blacklist state of participant 1.
 */
export async function shareSyncingAnswerAcrossCallers(h: MathPeerTestHarness) {
    await h.setup(2, { autoConnect: false });
    const { result } = await withSyncingSecondParticipant(
        h,
        async ({ participant, responder }) => {
            const responderStub = h.control(responder).stub;
            await responderStub.holdSpectateResponses().request();
            try {
                const pending = h.execOnHost(
                    participant,
                    (sm, a) => {
                        const spectate = sm.p2pManager.localRpc.spectateService;
                        const target = [sm.channelId, sm.forkId, 0] as const;
                        return Promise.all([
                            spectate.requestSync(a.responder, ...target),
                            spectate.syncBlockSource(a.responder, ...target),
                            spectate.syncBlockSource(a.responder, ...target),
                            spectate.syncBlockSource(a.responder, ...target)
                        ]);
                    },
                    { responder: responder.address },
                    { timeoutMs: h.event.hostExecTimeoutMs() }
                );
                await waitFor(
                    async () =>
                        (await responderStub
                            .getHeldSpectateResponseCount()
                            .request()) === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const answeredRequests = await responderStub
                    .releaseSpectateResponses()
                    .request();
                const results = await pending;
                const query = h.control(participant).query;
                return {
                    results,
                    answeredRequests,
                    strikes: await query
                        .getStrikes(responder.address)
                        .request(),
                    isBlacklisted: await query
                        .isBlacklisted(responder.address)
                        .request()
                };
            } finally {
                await responderStub.releaseSpectateResponses().request();
            }
        }
    );
    return result;
}

/**
 * Participant 0 queues a future block whose only source is the
 * still-syncing participant 1 of {@link withSyncingSecondParticipant}, then
 * runs that block's held queue timeout: the expiry probe asks participant 1,
 * which answers it is still syncing. Returns whether the block was queued
 * before the timeout, participant 0's strikes on participant 1 before and
 * after the probe, and its blacklist state.
 */
export async function probeSyncingQueuedSource(h: MathPeerTestHarness) {
    await h.setup(2, { autoConnect: false });
    const { result } = await withSyncingSecondParticipant(
        h,
        async ({ participant, responder }) => {
            const query = h.control(participant).query;
            const strikes = async () =>
                await query.getStrikes(responder.address).request();
            const queueTimeouts = await h.rpcStub.holdScheduledTasks(
                participant.index,
                "BlockQueueManager.queueTimeout -"
            );
            try {
                const future =
                    await h.byzantine.craftUnbackedFutureBlockConfirmation(
                        responder.index,
                        h.activeForkId!,
                        1
                    );
                await h
                    .control(participant)
                    .transition.ingestBlockConfirmation(
                        future.encodedBlockConfirmation,
                        {
                            origin: BlockOrigin.NETWORK,
                            senderAddress: responder.address
                        }
                    )
                    .request();
                const wasQueued = await query
                    .isBlockQueued(future.hash)
                    .request();
                const strikesBefore = await strikes();
                await queueTimeouts.runHeld();
                await waitFor(
                    async () => (await strikes()) > strikesBefore,
                    h.event.protocolEventTimeoutMs()
                );
                return {
                    wasQueued,
                    strikesBefore,
                    strikesAfter: await strikes(),
                    isBlacklisted: await query
                        .isBlacklisted(responder.address)
                        .request()
                };
            } finally {
                await queueTimeouts.release(false);
            }
        }
    );
    return result;
}

/**
 * The restarted participant 1's own initial sync from participant 0 is held
 * at its application step, so participant 1 stays OPENED. A fresh observer
 * whose pairs with participant 0 are blacklisted reaches only participant 1,
 * which builds its answer to the observer's initial sync request and holds
 * it. The observer's pair with participant 0 is then restored; the
 * observer's check of participant 0 ends while that request is in flight,
 * so it starts no sync. Then the held answer is sent. Returns the observer,
 * its connect result, its sync results, targets and the delay of its next
 * request, its sync calls before the answer was sent, the window, and its
 * connection and strikes to participant 1 after the sync.
 */
export async function syncPastSyncingParticipant(h: MathPeerTestHarness) {
    const { participant, responder } = await restartSecondParticipant(h);
    const observer = await createObserverIsolatedFrom(h, participant);
    await h.rpcStub.recordSpectateSync(observer.index, { forward: true });
    const releaseAnswer = await h.rpcStub.holdSpectateResponses(
        responder.index
    );
    const held = await h.rpcStub.holdSpectateSyncApplication(
        responder.index,
        participant.index
    );
    const windowMs = await h.execOnHost(
        participant,
        async (sm) => sm.timeConfig.agreementTime * 1000
    );
    let released = false;
    try {
        const responderConnect =
            responder.p2pInstance.p2pSigner.connectToChannel(h.channelId);
        await waitFor(
            async () => (await held.entered()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        const observerConnect = observer.p2pInstance.p2pSigner.connectToChannel(
            h.channelId
        );
        await waitFor(
            async () =>
                (await h
                    .control(responder)
                    .stub.getHeldSpectateResponseCount()
                    .request()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        await h.network.restorePairDiscovery(observer.index, participant.index);
        // the hook runs once the participant check (and the sync it would start) ended
        await waitFor(
            async () =>
                (observer.eventSpies.onConnection?.getCalls() ?? []).some(
                    (call) =>
                        String(call.args[0]).toLowerCase() ===
                        participant.address.toLowerCase()
                ),
            h.event.protocolEventTimeoutMs()
        );
        const syncCallsBeforeAnswer = await h.rpcStub.spectateSyncCallCount(
            observer.index
        );
        await releaseAnswer();
        const observerConnected = await observerConnect;
        const query = h.control(observer).query;
        const toResponder = {
            connected: await query.isConnectedTo(responder.address).request(),
            strikes: await query.getStrikes(responder.address).request()
        };
        released = true;
        await held.release();
        return {
            participant,
            responder,
            observer,
            windowMs,
            syncCallsBeforeAnswer,
            ...(await observerSyncs(h, observer)),
            toResponder,
            observerConnected,
            responderConnected: await responderConnect
        };
    } finally {
        if (!released) {
            await releaseAnswer();
            await held.release();
        }
    }
}

/**
 * The restarted participant 1's own initial sync from participant 0 is held
 * at its application step, so participant 1 stays OPENED. Participant 0
 * sends it a raw spectate request, then a plain sync. Returns the raw
 * answer, its duration, the window, the sync result, participant 1's status
 * after the probe, participant 0's connection and strikes to participant 1
 * after the sync, participant 0's `onSetState` count before the probe, and
 * participant 1's connect result once its held sync is released.
 */
export async function probeSyncingParticipant(h: MathPeerTestHarness) {
    const { participant, responder } = await restartSecondParticipant(h);
    const held = await h.rpcStub.holdSpectateSyncApplication(
        responder.index,
        participant.index
    );
    let released = false;
    try {
        const responderConnect =
            responder.p2pInstance.p2pSigner.connectToChannel(h.channelId);
        await waitFor(
            async () => (await held.entered()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        const setStatesBefore = h.event.getEventCallCount(
            participant.index,
            "onSetState"
        );
        const probe = await h.execOnHost(
            participant,
            async (sm, a) => {
                const started = Date.now();
                const response = await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({ channelId: sm.channelId })
                    .request(a.responder);
                const elapsedMs = Date.now() - started;
                const syncResult =
                    await sm.p2pManager.localRpc.spectateService.requestSync(
                        a.responder,
                        sm.channelId
                    );
                return {
                    response,
                    elapsedMs,
                    windowMs: sm.timeConfig.agreementTime * 1000,
                    syncResult
                };
            },
            { responder: responder.address }
        );
        const responderStatusAfterProbe = await h
            .control(responder)
            .query.getStatus()
            .request();
        const query = h.control(participant).query;
        const toResponder = {
            connected: await query.isConnectedTo(responder.address).request(),
            strikes: await query.getStrikes(responder.address).request()
        };
        released = true;
        await held.release();
        return {
            participant,
            responder,
            probe,
            responderStatusAfterProbe,
            toResponder,
            setStatesBefore,
            responderConnected: await responderConnect
        };
    } finally {
        if (!released) await held.release();
    }
}

/**
 * Participants 0 and 1 open the channel and a spectator syncs from them. A
 * fresh runtime whose pairs with both participants are blacklisted both ways
 * connects, so its only handshake is with the spectator: it stays OPENED and
 * starts no initial sync. The spectator probes it with a plain sync.
 * Returns the probe result, the fresh runtime's status, own sync calls and
 * abort state when the probe returned, the spectator's connection and
 * strikes to it then, and its connect result.
 */
export async function probeOpenedRuntimeWithoutParticipant(
    h: MathPeerTestHarness
) {
    await h.setup(2, { autoConnect: false });
    await h.lifecycle.openChannelForParticipants([0, 1]);
    await h.network.joinSelectedKey([0, 1], String(h.channelId));
    const participants = [h.getPeer(0), h.getPeer(1)];
    const spectatorIndex = h.peers.length;
    await h.createPeer(
        spectatorIndex,
        h.signerFor(slotAccountIndex(spectatorIndex))
    );
    const spectator = h.getPeer(spectatorIndex);
    const spectatorConnected =
        await spectator.p2pInstance.p2pSigner.connectToChannel(h.channelId);
    const responderIndex = h.peers.length;
    await h.createPeer(
        responderIndex,
        h.signerFor(slotAccountIndex(responderIndex))
    );
    const responder = h.getPeer(responderIndex);
    for (const participant of participants)
        for (const [from, to] of [
            [responder, participant],
            [participant, responder]
        ])
            await h
                .control(from)
                .network.blacklistAndDisconnectPeerByAddress(to.address)
                .request();
    await h.rpcStub.recordSpectateSync(responder.index, { forward: true });
    await h.rpcStub.stubCountSpectateRequests(responder.index);
    const responderConnect = responder.p2pInstance.p2pSigner.connectToChannel(
        h.channelId
    );
    await waitFor(
        async () =>
            (await h
                .control(spectator)
                .query.isConnectedTo(responder.address)
                .request()) &&
            (await h
                .control(responder)
                .query.isConnectedTo(spectator.address)
                .request()),
        h.event.protocolEventTimeoutMs()
    );
    const syncResult = await h.execOnHost(
        spectator,
        async (sm, a) =>
            await sm.p2pManager.localRpc.spectateService.requestSync(
                a.responder,
                sm.channelId
            ),
        { responder: responder.address }
    );
    const responderAfterProbe = {
        status: await h.control(responder).query.getStatus().request(),
        syncCalls: await h.rpcStub.spectateSyncCallCount(responder.index),
        spectateRequests: await h.rpcStub.getSpectateRequestCount(
            responder.index
        ),
        isAborted: responder.eventSpies.onAbort?.called ?? false
    };
    const query = h.control(spectator).query;
    const toResponder = {
        connected: await query.isConnectedTo(responder.address).request(),
        strikes: await query.getStrikes(responder.address).request()
    };
    return {
        participants,
        spectator,
        responder,
        spectatorConnected,
        syncResult,
        responderAfterProbe,
        toResponder,
        responderConnected: await responderConnect
    };
}
