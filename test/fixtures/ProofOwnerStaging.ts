// @spec-test-coverage-ignore: proof-owner staging shared by mapped AgreementManager and snapshot-update tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { BuiltStateProof } from "@/agreementManager/AgreementManager";
import Block from "@/models/Block";
import type StateSnapshot from "@/models/StateSnapshot";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Status } from "@/types";
import type { BlockHeight, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import {
    chainSnapshot,
    syncSpectatorOnServedPayload
} from "@test/fixtures/MilestoneSyncStaging";
import { suppressTimeoutChecks } from "@test/fixtures/OlderDisputeStaging";
import { waitFor } from "@test/utils/waitFor";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";
import { ethers } from "ethers";

/** A snapshot projection: its hash, height, fork and state-machine state hash. */
export type SnapshotRef = {
    hash: string;
    height: number;
    forkId: string;
    stateHash: string;
};

/** One tier's walk of a proof (`AgreementManager.ProofTierWalk`). */
export type TierWalkView = {
    tier: string;
    /** null: the tier walked from the fork genesis */
    start: SnapshotRef | null;
    valid: boolean;
    snapshotMismatch: boolean;
    finalized: SnapshotRef;
    replayBlockIndex: number;
};

/** A proof built by `AgreementManager.buildStateProof`, with the chain's walk of it. */
export type BuiltProofView = {
    /** the proof itself, strings only */
    stateProof: StateProofStruct;
    milestoneHeights: number[][];
    /** per milestone, per block: the author and confirmation signers */
    milestoneSigners: string[][][];
    /** per milestone: the participants of its first block's snapshot */
    milestoneParticipants: string[][];
    start: SnapshotRef;
    startParticipants: string[];
    genesisHash: string;
    finalized: SnapshotRef;
    chainWalk: TierWalkView;
};

/** A strings-only copy of an encoded block confirmation. */
export function decodeConfirmation(encoded: string): BlockConfirmationStruct {
    const decoded = Codec.decode(encoded, Type.BlockConfirmation);
    return {
        signedBlock: {
            encodedBlock: String(decoded.signedBlock.encodedBlock),
            signature: String(decoded.signedBlock.signature)
        },
        signatures: [...decoded.signatures].map(String)
    };
}

/**
 * `buildStateProof(forkId, height, { finalizedOnly })` on the peer's host and
 * the chain tier's walk of the result. `thrown` carries a construction error;
 * nothing else is returned then.
 */
export async function tryBuildProofView(
    h: MathPeerTestHarness,
    peerIndex: number,
    options: {
        forkId?: ForkId;
        height?: BlockHeight;
        finalizedOnly?: boolean;
    } = {}
): Promise<{ thrown: string | null; view: BuiltProofView | null }> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const forkId = args.forkId ?? sm.forkId;
            const height =
                args.height ?? sm.storage.blocks.getNextBlockHeight(forkId) - 1;
            const ref = (snapshot: StateSnapshot) => ({
                hash: String(snapshot.hash),
                height: Number(snapshot.blockHeight),
                forkId: String(snapshot.forkID),
                stateHash: String(snapshot.snapshotData.stateMachineStateHash)
            });
            let built: BuiltStateProof;
            try {
                built = await am.buildStateProof(forkId, height, {
                    finalizedOnly: args.finalizedOnly ?? false
                });
            } catch (error) {
                return {
                    thrown:
                        error instanceof Error ? error.message : String(error),
                    view: null
                };
            }
            const chain = await am.walkFromChainAnchor(
                forkId,
                built.stateProof,
                built.evidence
            );
            const blocksOf = (milestone: {
                blockConfirmations: BlockConfirmationStruct[];
            }) =>
                milestone.blockConfirmations.map(
                    (confirmation) =>
                        am.getLastBlockFromMilestone({
                            blockConfirmations: [confirmation]
                        })!
                );
            const genesis =
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
            return {
                thrown: null,
                view: {
                    stateProof: {
                        milestones: built.stateProof.milestones.map(
                            (milestone) => ({
                                blockConfirmations:
                                    milestone.blockConfirmations.map(
                                        (confirmation) => ({
                                            signedBlock: {
                                                encodedBlock: String(
                                                    confirmation.signedBlock
                                                        .encodedBlock
                                                ),
                                                signature: String(
                                                    confirmation.signedBlock
                                                        .signature
                                                )
                                            },
                                            signatures:
                                                confirmation.signatures.map(
                                                    String
                                                )
                                        })
                                    )
                            })
                        )
                    },
                    milestoneHeights: built.stateProof.milestones.map(
                        (milestone) =>
                            blocksOf(milestone).map((block) =>
                                Number(block.height)
                            )
                    ),
                    milestoneSigners: built.stateProof.milestones.map(
                        (milestone) =>
                            blocksOf(milestone).map((block) =>
                                [...block.allSignerAddresses].map(String)
                            )
                    ),
                    milestoneParticipants: built.stateProof.milestones.map(
                        (milestone) =>
                            (
                                am.getSnapshotFromMilestone(milestone)
                                    ?.snapshotData.participants ?? []
                            ).map(String)
                    ),
                    start: ref(built.startSnapshot),
                    startParticipants:
                        built.startSnapshot.snapshotData.participants.map(
                            String
                        ),
                    genesisHash: String(genesis.hash),
                    finalized: ref(built.finalizedSnapshot),
                    chainWalk: {
                        tier: String(chain.tier),
                        start: chain.start ? ref(chain.start) : null,
                        valid: chain.valid,
                        snapshotMismatch: chain.snapshotMismatch,
                        finalized: ref(chain.finalizedSnapshot),
                        replayBlockIndex: chain.replayBlockIndex
                    }
                }
            };
        },
        {
            forkId: options.forkId ?? null,
            height: options.height ?? null,
            finalizedOnly: options.finalizedOnly ?? false
        }
    );
}

/** {@link tryBuildProofView} that must succeed. */
export async function buildProofView(
    h: MathPeerTestHarness,
    peerIndex: number,
    options: {
        forkId?: ForkId;
        height?: BlockHeight;
        finalizedOnly?: boolean;
    } = {}
): Promise<BuiltProofView> {
    const { thrown, view } = await tryBuildProofView(h, peerIndex, options);
    if (thrown !== null || !view)
        throw new Error(`buildStateProof threw: ${thrown}`);
    return view;
}

/**
 * Every tier walk `walkStateProofTiers` yields for `stateProof` on the peer,
 * with the walk evidence read from the peer's storage (`getStoredEvidence`).
 */
export async function walkAllTiersView(
    h: MathPeerTestHarness,
    peerIndex: number,
    stateProof: StateProofStruct,
    forkId?: ForkId
): Promise<TierWalkView[]> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const fork = args.forkId ?? sm.forkId;
            const ref = (snapshot: StateSnapshot) => ({
                hash: String(snapshot.hash),
                height: Number(snapshot.blockHeight),
                forkId: String(snapshot.forkID),
                stateHash: String(snapshot.snapshotData.stateMachineStateHash)
            });
            const walks = [];
            for await (const walk of am.walkStateProofTiers(
                fork,
                args.stateProof,
                am.getStoredEvidence(fork, args.stateProof)
            ))
                walks.push({
                    tier: String(walk.tier),
                    start: walk.start ? ref(walk.start) : null,
                    valid: walk.valid,
                    snapshotMismatch: walk.snapshotMismatch,
                    finalized: ref(walk.finalizedSnapshot),
                    replayBlockIndex: walk.replayBlockIndex
                });
            return walks;
        },
        { stateProof, forkId: forkId ?? null }
    );
}

/**
 * `verifyStateProof` on the peer with the evidence from its storage: the
 * accepted (or the chain's) walk, or the error it threw.
 */
export async function verifyProofView(
    h: MathPeerTestHarness,
    peerIndex: number,
    stateProof: StateProofStruct,
    forkId?: ForkId
): Promise<{ walk: TierWalkView | null; thrown: string | null }> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const fork = args.forkId ?? sm.forkId;
            const ref = (snapshot: StateSnapshot) => ({
                hash: String(snapshot.hash),
                height: Number(snapshot.blockHeight),
                forkId: String(snapshot.forkID),
                stateHash: String(snapshot.snapshotData.stateMachineStateHash)
            });
            try {
                const walk = await am.verifyStateProof(
                    fork,
                    args.stateProof,
                    am.getStoredEvidence(fork, args.stateProof)
                );
                return {
                    thrown: null,
                    walk: {
                        tier: String(walk.tier),
                        start: walk.start ? ref(walk.start) : null,
                        valid: walk.valid,
                        snapshotMismatch: walk.snapshotMismatch,
                        finalized: ref(walk.finalizedSnapshot),
                        replayBlockIndex: walk.replayBlockIndex
                    }
                };
            } catch (error) {
                return {
                    thrown:
                        error instanceof Error ? error.message : String(error),
                    walk: null
                };
            }
        },
        { stateProof, forkId: forkId ?? null }
    );
}

/** `getLocalFinalizedSnapshot` on the peer: the tier-1 start, or null. */
export async function localFinalizedView(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId?: ForkId
): Promise<SnapshotRef | null> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const snapshot =
                await sm.agreementManager.getLocalFinalizedSnapshot(
                    args.forkId ?? sm.forkId
                );
            return snapshot
                ? {
                      hash: String(snapshot.hash),
                      height: Number(snapshot.blockHeight),
                      forkId: String(snapshot.forkID),
                      stateHash: String(
                          snapshot.snapshotData.stateMachineStateHash
                      )
                  }
                : null;
        },
        { forkId: forkId ?? null }
    );
}

/**
 * The same-fork snapshot-update preparation on the peer
 * (`prepareUpdateSnapshotSameFork`): calldata count, target and proof shape.
 */
export async function prepareSameForkView(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<{
    canPost: boolean;
    callDataCount: number;
    expectedSnapshotHash: string | null;
    milestoneHeights: number[][];
}> {
    return h.execOnHost(h.getPeer(peerIndex), async (sm) => {
        const prepared = await sm.snapshotUpdateService[
            "prepareUpdateSnapshotSameFork"
        ](sm.forkId);
        return {
            canPost: prepared.canPost,
            callDataCount: prepared.callData.length,
            expectedSnapshotHash: prepared.expectedSnapshot
                ? String(prepared.expectedSnapshot.hash)
                : null,
            milestoneHeights: prepared.milestoneProofs.map((milestone) =>
                milestone.blockConfirmations.map((confirmation) =>
                    Number(
                        sm.agreementManager.getLastBlockFromMilestone({
                            blockConfirmations: [confirmation]
                        })!.height
                    )
                )
            )
        };
    });
}

/** `postStateSnapshotWait` on the peer; the posting outcome. */
export async function postSnapshotFrom(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<boolean> {
    return h.execOnHost(h.getPeer(peerIndex), (sm) =>
        sm.snapshotUpdateService.postStateSnapshotWait(sm.forkId)
    );
}

/**
 * Peer 0 posts the latest final point as the chain anchor; every peer not in
 * `laggingIndices` waits until its local diamond mirrors it. A lagging peer
 * holds the StateSnapshotUpdated event (its mirror keeps the older snapshot).
 */
export async function postAnchor(
    h: MathPeerTestHarness,
    options: { laggingIndices?: number[] } = {}
): Promise<{ hash: string; height: number }> {
    const lagging = options.laggingIndices ?? [];
    for (const index of lagging)
        await h
            .control(h.getPeer(index))
            .stub.stubHoldSnapshotUpdatedEvents()
            .request();
    const before = await chainSnapshot(h);
    expect(await postSnapshotFrom(h, 0), "the anchor post").to.equal(true);
    const anchor = await chainSnapshot(h);
    expect(anchor.hash, "the post moved the chain anchor").to.not.equal(
        before.hash
    );
    const current = h.peers.filter((peer) => !lagging.includes(peer.index));
    await waitFor(async () => {
        for (const peer of current)
            if (
                (await h.query.getLocalStateSnapshot(peer)).hash !== anchor.hash
            )
                return false;
        return true;
    }, h.event.protocolEventTimeoutMs());
    for (const index of lagging)
        await waitFor(
            async () =>
                (await h
                    .control(h.getPeer(index))
                    .stub.getHeldSnapshotUpdatedCount()
                    .request()) > 0,
            h.event.protocolEventTimeoutMs()
        );
    return { hash: String(anchor.hash), height: anchor.blockHeight };
}

/** The peer index whose address authored the block at `height`. */
export async function authorIndexAt(
    h: MathPeerTestHarness,
    observerIndex: number,
    height: BlockHeight
): Promise<number> {
    const block = await h
        .control(h.getPeer(observerIndex))
        .query.getBlockByHeight(h.activeForkId!, height)
        .request();
    const author = h.peers.find((peer) => peer.address === block!.author);
    if (!author) throw new Error(`No harness peer authored height ${height}`);
    return author.index;
}

/** The stored snapshot hash the block at `height` commits to. */
export async function blockSnapshotHashAt(
    h: MathPeerTestHarness,
    observerIndex: number,
    height: BlockHeight,
    forkId?: ForkId
): Promise<string> {
    const block = await h
        .control(h.getPeer(observerIndex))
        .query.getBlockByHeight(forkId ?? h.activeForkId!, height)
        .request();
    return block!.stateSnapshotHash;
}

/**
 * Three peers, blocks 0..1 final (fully signed), every timeout check
 * suppressed. With `postAnchor` peer 0 posts block 1's snapshot as the chain
 * anchor. Then the author of block 1 goes offline and the two others author
 * `tailBlocks` blocks without its signature: an unfinalized tail. Returns the
 * observer (an online peer) and the offline peer.
 */
export async function stageFinalThenUnfinalizedTail(
    h: MathPeerTestHarness,
    options: { postAnchor: boolean; tailBlocks?: number }
): Promise<{
    forkId: ForkId;
    anchor: { hash: string; height: number } | null;
    observerIndex: number;
    offlineIndex: number;
    latestHeight: number;
}> {
    await h.lifecycle.start(3, 2);
    await suppressTimeoutChecks(h, [0, 1, 2]);
    const forkId = h.activeForkId!;
    const anchor = options.postAnchor ? await postAnchor(h) : null;
    // the latest author writes again only after both others
    const offlineIndex = await authorIndexAt(h, 0, 1);
    const online = [0, 1, 2].filter((index) => index !== offlineIndex);
    await h.network.blacklistAndDisconnectPeer(offlineIndex);
    const tailBlocks = options.tailBlocks ?? 2;
    await h.transition.advanceState({
        count: tailBlocks,
        waitForPeers: online,
        waitForFinalization: false
    });
    const observerIndex = online[0];
    expect(
        await h
            .control(h.getPeer(observerIndex))
            .query.didEveryoneSignBlockAt(forkId, 1)
            .request(),
        "block 1 is fully signed"
    ).to.equal(true);
    expect(
        await h
            .control(h.getPeer(observerIndex))
            .query.didEveryoneSignBlockAt(forkId, 1 + tailBlocks)
            .request(),
        "the tail lacks the offline peer's signature"
    ).to.equal(false);
    return {
        forkId,
        anchor,
        observerIndex,
        offlineIndex,
        latestHeight: 1 + tailBlocks
    };
}

/**
 * Three peers, blocks 0..1 final, every timeout check suppressed. With
 * `postAnchor` peer 0 posts block 1's snapshot as the chain anchor (a peer in
 * `laggingIndices` holds the snapshot event, so its mirror lags). Then
 * `finalBlocks` more fully signed blocks.
 */
export async function stageFinalBlocks(
    h: MathPeerTestHarness,
    options: {
        postAnchor: boolean;
        finalBlocks: number;
        laggingIndices?: number[];
    }
): Promise<{
    forkId: ForkId;
    anchor: { hash: string; height: number } | null;
    latestHeight: number;
}> {
    await h.lifecycle.start(3, 2);
    await suppressTimeoutChecks(h, [0, 1, 2]);
    const anchor = options.postAnchor
        ? await postAnchor(h, { laggingIndices: options.laggingIndices })
        : null;
    if (options.finalBlocks > 0)
        await h.transition.advanceState({
            count: options.finalBlocks,
            waitForFinalization: true
        });
    await h.assert.sync.peersInSyncWait();
    return {
        forkId: h.activeForkId!,
        anchor,
        latestHeight: 1 + options.finalBlocks
    };
}

/**
 * Three peers; `laggingIndex`'s local diamond misses the
 * InboundMessagesProcessed log of peer 0's top-up while its storage keeps up;
 * two fully signed blocks consume the top-up. With `anchorBeforeTopUp` peer 0
 * posts block 1's snapshot as the chain anchor before the top-up (every
 * mirror has it); with `anchorAfterTopUp` peer 0 posts the final point that
 * consumed the top-up while the lagging peer also holds that snapshot event.
 */
export async function stageMirrorMissingTopUp(
    h: MathPeerTestHarness,
    options: {
        laggingIndex: number;
        anchorBeforeTopUp?: boolean;
        anchorAfterTopUp?: boolean;
    }
): Promise<{
    forkId: ForkId;
    anchor: { hash: string; height: number } | null;
    latestHeight: number;
}> {
    await h.lifecycle.start(3, 2);
    await suppressTimeoutChecks(h, [0, 1, 2]);
    let anchor = options.anchorBeforeTopUp ? await postAnchor(h) : null;
    const held = await h.mirror.holdUpdates(
        options.laggingIndex,
        "onInboundMessagesProcessed"
    );
    await h.join.forceInboundJoinWait({ participant: h.getPeer(0).address });
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    expect(
        await held.heldCount(),
        "the lagging mirror must have missed the top-up"
    ).to.be.greaterThan(0);
    if (options.anchorAfterTopUp)
        anchor = await postAnchor(h, {
            laggingIndices: [options.laggingIndex]
        });
    const latestHeight = Number(
        await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(h.activeForkId!)
            .request()
    );
    return { forkId: h.activeForkId!, anchor, latestHeight };
}

/**
 * An authentic block at `anchorHeight + 1` by the author of the stored block
 * at that height, but a different block: it links to the stored anchor-height
 * block (`linked`) or to a random hash, and commits a random snapshot. Returns
 * the proof holding the stored anchor-height block and that block.
 */
export async function craftConflictingAnchorRun(
    h: MathPeerTestHarness,
    options: { observerIndex: number; anchorHeight: number; linked: boolean }
): Promise<StateProofStruct> {
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(options.observerIndex)).query;
    const anchorBlock = await query
        .getBlockByHeight(forkId, options.anchorHeight)
        .request();
    const authorIndex = await authorIndexAt(
        h,
        options.observerIndex,
        options.anchorHeight + 1
    );
    const encoded = await factory.buildAndEncodeBlock(
        h.getPeer(authorIndex).signer,
        {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: options.anchorHeight + 1,
                participant: h.getPeer(authorIndex).address
            },
            previousBlockHash: options.linked
                ? anchorBlock!.hash
                : ethers.hexlify(ethers.randomBytes(32))
        }
    );
    return {
        milestones: [
            {
                blockConfirmations: [
                    decodeConfirmation(anchorBlock!.encodedBlockConfirmation),
                    decodeConfirmation(encoded)
                ]
            }
        ]
    };
}

/** The peer's encoded block confirmations at `heights`, as stored now. */
export async function storedConfirmations(
    h: MathPeerTestHarness,
    peerIndex: number,
    heights: number[]
): Promise<BlockConfirmationStruct[]> {
    const confirmations: BlockConfirmationStruct[] = [];
    for (const height of heights) {
        const block = await h
            .control(h.getPeer(peerIndex))
            .query.getBlockByHeight(h.activeForkId!, height)
            .request();
        confirmations.push(decodeConfirmation(block!.encodedBlockConfirmation));
    }
    return confirmations;
}

/**
 * Store genuine blocks back into the peer's block storage after a test
 * pruned them (the inverse of `stub.pruneStoredBlocksBelowAnchor`). The view
 * does not move: the blocks are only persisted.
 */
export async function restoreStoredBlocks(
    h: MathPeerTestHarness,
    peerIndex: number,
    confirmations: BlockConfirmationStruct[]
): Promise<number> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) => {
            let stored = 0;
            for (const confirmation of args.confirmations) {
                const block = sm.agreementManager.getLastBlockFromMilestone({
                    blockConfirmations: [confirmation]
                })!;
                if (
                    sm.storage.blocks.storeBlock(block, {
                        hash: block.hash,
                        coordinates: block.coordinates,
                        justPersist: true
                    })
                )
                    stored++;
            }
            return stored;
        },
        { confirmations }
    );
}

/** The address's harness peer index. */
function peerIndexOf(h: MathPeerTestHarness, address: string): number {
    const peer = h.peers.find((candidate) => candidate.address === address);
    if (!peer) throw new Error(`No harness peer at ${address}`);
    return peer.index;
}

/**
 * Two peers; a spectator syncs and joins (peer 2). With `postAnchor` peer 0
 * posts the final point as the chain anchor (and one more block refreshes
 * the authoring window) before the join. The two peers that do not author
 * the join block `j` are muted before it, so `j` carries only its author's
 * (the observer's) signature. After `j` the writers author in turn; the first
 * muted peer whose turn comes is unmuted and authors normally. The other
 * muted (late) peer authors its first block `t` while muted, and only the
 * observer (muted too) ingests it. The observer then holds the late signer's
 * signature only on `t`, and `t - 1` signed by both other participants.
 */
export async function stageJoinHopWithLaterFinalPoint(
    h: MathPeerTestHarness,
    options: { postAnchor: boolean; beforeJoin?: () => Promise<void> }
): Promise<{
    forkId: ForkId;
    anchor: { hash: string; height: number } | null;
    joinHeight: number;
    observerIndex: number;
    latestHeight: number;
}> {
    await h.lifecycle.start(2, 0);
    await suppressTimeoutChecks(h, [0, 1]);
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await suppressTimeoutChecks(h, [spectator.index]);
    await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });
    let anchor: { hash: string; height: number } | null = null;
    if (options.postAnchor) {
        anchor = await postAnchor(h);
        // the post idled the writer slot: a fresh block before the join
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
    }
    const forkId = h.activeForkId!;
    const q0 = h.control(h.getPeer(0)).query;
    // Keep the deliberately missing votes absent even when fallback posts
    // these blocks on chain while a caller connects a later spectator.
    for (const index of [0, 1, 2])
        await h
            .control(h.getPeer(index))
            .stub.stubHoldCalldataPostedEvents()
            .request();
    await options.beforeJoin?.();
    await h.join.joinChannelWait({ joiner: spectator });
    await h.assert.storage.honestPeersObserveInboundMessageWait();
    // j's author is the observer; the two others are muted before j exists
    const observerIndex = peerIndexOf(h, await q0.getNextToWrite().request());
    const observer = h.control(h.getPeer(observerIndex)).query;
    const muted = [0, 1, 2].filter((index) => index !== observerIndex);
    for (const index of muted) await h.byzantine.stubBroadcast(index);
    const joinHeight = Number(
        await observer.getNextBlockHeight(forkId).request()
    );
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    expect(
        await observer.getParticipantChangeHeights(forkId).request(),
        "the join lands in the next block"
    ).to.include(joinHeight);
    expect(
        await authorIndexAt(h, observerIndex, joinHeight),
        "the join block's author is the expected writer"
    ).to.equal(observerIndex);
    // writers author in turn until the second muted peer's turn; the first
    // muted peer to get a turn is unmuted first
    let unmutedIndex: number | undefined;
    let lateIndex: number | undefined;
    for (let block = 0; block < 6 && lateIndex === undefined; block++) {
        const next = peerIndexOf(h, await observer.getNextToWrite().request());
        if (
            unmutedIndex !== undefined &&
            muted.includes(next) &&
            next !== unmutedIndex
        ) {
            lateIndex = next;
            break;
        }
        if (unmutedIndex === undefined && muted.includes(next)) {
            unmutedIndex = next;
            await h.control(h.getPeer(next)).stub.restoreBroadcast().request();
        }
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });
    }
    if (lateIndex === undefined || unmutedIndex === undefined)
        throw new Error("The late signer's turn did not come");
    const latestHeight = Number(
        await observer.getNextBlockHeight(forkId).request()
    );
    // t - 1 carries both other participants' signatures at the observer
    const otherAddresses = [
        h.getPeer(observerIndex).address,
        h.getPeer(unmutedIndex).address
    ];
    await waitFor(async () => {
        const block = await observer
            .getBlockByHeight(forkId, latestHeight - 1)
            .request();
        const signers = [block!.author, ...block!.confirmationSignerAddresses];
        return otherAddresses.every((address) => signers.includes(address));
    }, h.event.protocolEventTimeoutMs());
    // the late signer authors t while muted; only the observer gets it
    await h.byzantine.stubBroadcast(observerIndex);
    await h.getPeer(lateIndex).p2pInstance.p2pContractInstance.add(1);
    const late = h.control(h.getPeer(lateIndex)).query;
    await waitFor(
        async () =>
            (await late.getNextBlockHeight(forkId).request()) ===
            latestHeight + 1,
        h.event.protocolEventTimeoutMs()
    );
    const lateBlock = await late
        .getBlockByHeight(forkId, latestHeight)
        .request();
    await h.transition.ingestBlockConfirmationWait({
        peerIndex: observerIndex,
        blockConfirmation: decodeConfirmation(
            lateBlock!.encodedBlockConfirmation
        ),
        ingestOptions: {
            origin: BlockOrigin.NETWORK,
            senderAddress: h.getPeer(lateIndex).address
        },
        keepConnection: true
    });
    await waitFor(
        async () =>
            (await observer.getNextBlockHeight(forkId).request()) ===
            latestHeight + 1,
        h.event.protocolEventTimeoutMs()
    );
    // the observer holds the late signer's signature only on t
    for (let height = joinHeight; height < latestHeight; height++) {
        const block = await observer.getBlockByHeight(forkId, height).request();
        expect(
            [block!.author, ...block!.confirmationSignerAddresses],
            `block ${height} lacks the late signer`
        ).to.not.include(h.getPeer(lateIndex).address);
    }
    return { forkId, anchor, joinHeight, observerIndex, latestHeight };
}

/**
 * Two peers; a spectator syncs and joins (peer 2) and the join block is
 * fully signed. Then the participant whose turn is third after the join
 * goes offline and the two others author two blocks without its signature.
 */
export async function stageFinalJoinThenUnfinalizedTail(
    h: MathPeerTestHarness,
    options: {
        /** peer 0 posts the final point as the chain anchor before the join */
        postAnchor?: boolean;
        /**
         * the offline peer does not author the join block: its signature on
         * it is a confirmation that a test can strip
         */
        offlineConfirmsJoin?: boolean;
    } = {}
): Promise<{
    forkId: ForkId;
    anchor: { hash: string; height: number } | null;
    joinHeight: number;
    observerIndex: number;
    offlineIndex: number;
    latestHeight: number;
}> {
    await h.lifecycle.start(2, 0);
    await suppressTimeoutChecks(h, [0, 1]);
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await suppressTimeoutChecks(h, [spectator.index]);
    await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(0)).query;
    const anchor = options.postAnchor ? await postAnchor(h) : null;
    // the post idles the writer slot: fresh blocks before the join. The join
    // block j is written by roster[j % 2] and the offline peer below is
    // roster[j % 3] (the writer index is the block height); they differ
    // unless j % 6 is 0 or 1.
    let refresh = options.postAnchor ? 1 : 0;
    if (options.offlineConfirmsJoin)
        while (
            [0, 1].includes(
                (Number(await query.getNextBlockHeight(forkId).request()) +
                    refresh) %
                    6
            )
        )
            refresh++;
    if (refresh > 0)
        await h.transition.advanceState({
            count: refresh,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
    await h.join.joinChannelWait({ joiner: spectator });
    await h.assert.storage.honestPeersObserveInboundMessageWait();
    const joinHeight = Number(await query.getNextBlockHeight(forkId).request());
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    expect(
        await query.getParticipantChangeHeights(forkId).request(),
        "the join lands in the next block"
    ).to.include(joinHeight);
    // every peer holds the join block with every signature
    await waitFor(async () => {
        for (const index of [0, 1, 2])
            if (
                (await h
                    .control(h.getPeer(index))
                    .query.didEveryoneSignBlockAt(forkId, joinHeight)
                    .request()) !== true
            )
                return false;
        return true;
    }, h.event.protocolEventTimeoutMs());
    // after the join the writers cycle the roster [peer 0, peer 1, joiner]
    // from the next writer: the third in the cycle authors neither j + 1 nor
    // j + 2 and goes offline
    const roster = [0, 1, spectator.index];
    const nextWriter = peerIndexOf(h, await query.getNextToWrite().request());
    const offlineIndex = roster[(roster.indexOf(nextWriter) + 2) % 3];
    if (options.offlineConfirmsJoin)
        expect(
            await authorIndexAt(h, 0, joinHeight),
            "the offline peer did not author the join block"
        ).to.not.equal(offlineIndex);
    const online = [0, 1, 2].filter((index) => index !== offlineIndex);
    await h.network.blacklistAndDisconnectPeer(offlineIndex);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: online,
        waitForFinalization: false
    });
    for (const height of [joinHeight + 1, joinHeight + 2])
        expect(
            await authorIndexAt(h, online[0], height),
            `block ${height} is not the offline peer's`
        ).to.not.equal(offlineIndex);
    return {
        forkId,
        anchor,
        joinHeight,
        observerIndex: online[0],
        offlineIndex,
        latestHeight: joinHeight + 2
    };
}

/**
 * Two peers; a spectator syncs and joins (peer 2) at `j`, three fully signed
 * blocks follow, and on its next turn the joiner leaves at `k` (its own,
 * fully signed leave block). Two more fully signed blocks by the remaining
 * participants follow; the leaver settles. The joiner is in neither the
 * snapshot before `j` nor the snapshot of `k`, and its JOIN lies between
 * their inbound heads. The leave posts the exit snapshot, whose update prunes
 * the consumed inbound blocks: peer 0's mirror holds that snapshot update
 * and the pruning (a mirror behind the chain), so it keeps no anchor and the
 * JOIN's inbound block.
 */
export async function stageJoinThenLeave(h: MathPeerTestHarness): Promise<{
    forkId: ForkId;
    joinHeight: number;
    leaveHeight: number;
    joinerIndex: number;
    latestHeight: number;
}> {
    await h.lifecycle.start(2, 0);
    await suppressTimeoutChecks(h, [0, 1]);
    const { peer: joiner } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await suppressTimeoutChecks(h, [joiner.index]);
    await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });
    await h.join.joinChannelWait({ joiner });
    await h.assert.storage.honestPeersObserveInboundMessageWait();
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(0)).query;
    const joinHeight = Number(await query.getNextBlockHeight(forkId).request());
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    expect(
        await query.getParticipantChangeHeights(forkId).request(),
        "the join lands in the next block"
    ).to.include(joinHeight);
    await h.transition.advanceState({
        count: 3,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    for (
        let block = 0;
        block < 3 &&
        (await query.getNextToWrite().request()) !== joiner.address;
        block++
    )
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
    const leaveHeight = Number(
        await query.getNextBlockHeight(forkId).request()
    );
    await h
        .control(h.getPeer(0))
        .stub.stubHoldSnapshotUpdatedEvents()
        .request();
    const pruning = await h.mirror.holdUpdates(0, "onChannelStorageCleared");
    await h.transition.participantLeaveDetached({
        leaverIndex: joiner.index,
        waitForPeers: [0, 1, 2]
    });
    expect(
        await authorIndexAt(h, 0, leaveHeight),
        "the joiner authors its own leave"
    ).to.equal(joiner.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 1],
        waitForFinalization: true
    });
    await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
    expect(
        await pruning.heldCount(),
        "peer 0's mirror held the exit snapshot's inbound pruning"
    ).to.be.greaterThan(0);
    return {
        forkId,
        joinHeight,
        leaveHeight,
        joinerIndex: joiner.index,
        latestHeight: leaveHeight + 2
    };
}

/**
 * The peer loses its stored block at `height` (test-harness pruning of one
 * block): a stored run through that height no longer links.
 */
export async function dropStoredBlock(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: BlockHeight
): Promise<void> {
    const dropped = await h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) => sm.storage.blocks.deleteBlock(sm.forkId, args.height),
        { height }
    );
    expect(dropped, `a stored block at height ${height}`).to.equal(true);
}

/**
 * Peer `signerIndex` signs the stored block at `height` and the peer
 * `peerIndex` stores that confirmation signature with the block.
 */
export async function addStoredSignature(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: BlockHeight,
    signerIndex: number
): Promise<void> {
    const block = await h
        .control(h.getPeer(peerIndex))
        .query.getBlockByHeight(h.activeForkId!, height)
        .request();
    const signature = await h
        .getPeer(signerIndex)
        .signer.signMessage(ethers.getBytes(block!.hash));
    const stored = await h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) =>
            !!sm.storage.blocks.insertSignature(
                args.signature,
                sm.forkId,
                args.height
            ),
        { signature, height }
    );
    expect(stored, `a stored block at height ${height}`).to.equal(true);
}

/**
 * Two peers, then two spectators join one after the other (peers 2 and 3);
 * each join is followed by enough fully signed blocks to prove it, so the
 * latest block is final on its own.
 */
export async function stageTwoJoins(h: MathPeerTestHarness): Promise<{
    forkId: ForkId;
    changeHeights: number[];
    latestHeight: number;
}> {
    await h.lifecycle.start(2, 0);
    for (const authors of [
        [0, 1],
        [0, 1, 2]
    ]) {
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: authors,
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const members = [...authors, joiner.index];
        await h.assert.sync.peersInSyncWait({ peerIndices: members });
        await h.join.joinChannelWait({ joiner });
        await h.assert.storage.honestPeersObserveInboundMessageWait();
        await h.transition.advanceState({
            count: members.length + 1,
            waitForPeers: members,
            waitForFinalization: true
        });
    }
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(0)).query;
    return {
        forkId,
        changeHeights: await query
            .getParticipantChangeHeights(forkId)
            .request(),
        latestHeight: Number(await query.getLatestBlockHeight(forkId).request())
    };
}

/**
 * Three peers, blocks 0..1 final. Block 2 (peer 2's turn) misses peer 0's
 * signature (peer 0 muted); peer 0 then authors block 3 while muted and only
 * peer 1 (muted too) ingests it. Peer 1 holds block 2 signed by peers 2 and 1
 * and block 3 signed by peers 0 and 1: block 3's evidence finalizes block 2.
 */
export async function stageFinalityFromNextBlock(
    h: MathPeerTestHarness,
    beforeVirtualVotes?: () => Promise<void>
): Promise<{ forkId: ForkId; observerIndex: number }> {
    await h.lifecycle.start(3, 2);
    await suppressTimeoutChecks(h, [0, 1, 2]);
    const forkId = h.activeForkId!;
    const observerIndex = 1;
    // Muted gossip must not be bypassed by fallback calldata while a caller
    // connects another peer: peer 2 must never learn and sign block 3 here.
    // This drops subscription deliveries, with no paused call to release;
    // the fixture's peers and their patches are discarded with the session.
    await h.rpcStub.holdCalldataPostedEventsExceptLeader(0);
    await beforeVirtualVotes?.();
    const observer = h.control(h.getPeer(observerIndex)).query;
    expect(
        await observer.getNextToWrite().request(),
        "block 2 is peer 2's turn"
    ).to.equal(h.getPeer(2).address);
    await h.byzantine.stubBroadcast(0);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    expect(
        await observer.getNextToWrite().request(),
        "block 3 is peer 0's turn"
    ).to.equal(h.getPeer(0).address);
    await h.byzantine.stubBroadcast(observerIndex);
    await h.getPeer(0).p2pInstance.p2pContractInstance.add(1);
    const author = h.control(h.getPeer(0)).query;
    await waitFor(
        async () => (await author.getNextBlockHeight(forkId).request()) === 4,
        h.event.protocolEventTimeoutMs()
    );
    const block3 = await author.getBlockByHeight(forkId, 3).request();
    await h.transition.ingestBlockConfirmationWait({
        peerIndex: observerIndex,
        blockConfirmation: decodeConfirmation(block3!.encodedBlockConfirmation),
        ingestOptions: {
            origin: BlockOrigin.NETWORK,
            senderAddress: h.getPeer(0).address
        },
        keepConnection: true
    });
    await waitFor(
        async () => (await observer.getNextBlockHeight(forkId).request()) === 4,
        h.event.protocolEventTimeoutMs()
    );
    expect(
        await observer.didEveryoneSignBlockAt(forkId, 2).request(),
        "block 2 alone is not final"
    ).to.equal(false);
    expect(
        await observer.didEveryoneSignBlockAt(forkId, 3).request(),
        "block 3 alone is not final"
    ).to.equal(false);
    return { forkId, observerIndex };
}

/**
 * A disputed four-peer fork whose source fork holds a posted non-genesis
 * anchor (block 1's snapshot). Peer 0 computes and installs the reduced
 * successor fork and is held at the reduction submit: the chain snapshot
 * stays on the source fork. `release` lets the submit go on.
 */
export async function stageUnpostedSuccessorFork(
    h: MathPeerTestHarness
): Promise<{
    sourceForkId: ForkId;
    successorForkId: ForkId;
    ancestorAnchor: StateSnapshot;
    release: () => Promise<void>;
}> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        beforeDispute: async () => {
            expect(
                await postSnapshotFrom(h, 0),
                "the ancestor anchor post"
            ).to.equal(true);
        }
    });
    const ancestorAnchor = await chainSnapshot(h);
    expect(ancestorAnchor.forkID).to.equal(sourceForkId);
    expect(
        ancestorAnchor.blockHeight,
        "a non-genesis ancestor anchor"
    ).to.be.greaterThan(0);
    const hold = await h.rpcStub.holdReductionAttempt(0, "submit");
    try {
        await h
            .control(h.getPeer(0))
            .stub.startTryReduce(sourceForkId)
            .request();
        await waitFor(async () => (await hold.entered()) === 1);
        const successorForkId = (await h
            .control(h.getPeer(0))
            .query.getForkId()
            .request()) as ForkId;
        expect(successorForkId).to.not.equal(sourceForkId);
        expect((await chainSnapshot(h)).forkID).to.equal(sourceForkId);
        return {
            sourceForkId,
            successorForkId,
            ancestorAnchor,
            release: hold.release
        };
    } catch (error) {
        await hold.release();
        throw error;
    }
}

/**
 * A disputed four-peer fork whose source fork holds a posted non-genesis
 * anchor. Peer 0 and the successor fork's first writer compute and install
 * the reduced successor fork and are held at the reduction submit, so the
 * chain snapshot stays on the source fork. The writer, muted, authors block 0
 * on the successor: block 0 links to the successor genesis and carries only
 * its author's signature. `release` lets every held submit go on.
 */
export async function stageSuccessorBlockZero(h: MathPeerTestHarness): Promise<{
    sourceForkId: ForkId;
    successorForkId: ForkId;
    ancestorAnchor: StateSnapshot;
    writerIndex: number;
    release: () => Promise<void>;
}> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        beforeDispute: async () => {
            expect(
                await postSnapshotFrom(h, 0),
                "the ancestor anchor post"
            ).to.equal(true);
        }
    });
    const ancestorAnchor = await chainSnapshot(h);
    expect(ancestorAnchor.forkID).to.equal(sourceForkId);
    expect(
        ancestorAnchor.blockHeight,
        "a non-genesis ancestor anchor"
    ).to.be.greaterThan(0);
    const holds: { release: () => Promise<void> }[] = [];
    const release = async () => {
        for (const hold of holds.splice(0)) await hold.release();
    };
    const installSuccessor = async (index: number) => {
        const hold = await h.rpcStub.holdReductionAttempt(index, "submit");
        holds.push(hold);
        await h
            .control(h.getPeer(index))
            .stub.startTryReduce(sourceForkId)
            .request();
        await waitFor(async () => (await hold.entered()) === 1);
    };
    try {
        await installSuccessor(0);
        const successorForkId = (await h
            .control(h.getPeer(0))
            .query.getForkId()
            .request()) as ForkId;
        expect(successorForkId).to.not.equal(sourceForkId);
        const writerIndex = peerIndexOf(
            h,
            await h.control(h.getPeer(0)).query.getNextToWrite().request()
        );
        if (writerIndex !== 0) await installSuccessor(writerIndex);
        const writer = h.control(h.getPeer(writerIndex)).query;
        expect(await writer.getForkId().request()).to.equal(successorForkId);
        await h.byzantine.stubBroadcast(writerIndex);
        await h.getPeer(writerIndex).p2pInstance.p2pContractInstance.add(1);
        await waitFor(
            async () =>
                (await writer.getNextBlockHeight(successorForkId).request()) ===
                1,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            (await chainSnapshot(h)).forkID,
            "the chain has not adopted the successor"
        ).to.equal(sourceForkId);
        return {
            sourceForkId,
            successorForkId,
            ancestorAnchor,
            writerIndex,
            release
        };
    } catch (error) {
        await release();
        throw error;
    }
}

/**
 * Every tier walk of the empty proof of `forkId` on peer 0, with the genesis
 * data of `genesisForkId` and, when given, `originForkId` in place of its
 * origin.
 */
export async function walkEmptyProofWithGenesis(
    h: MathPeerTestHarness,
    options: { forkId: ForkId; genesisForkId: ForkId; originForkId?: string }
): Promise<{ tier: string; valid: boolean; startForkId: string | null }[]> {
    return h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            const genesis =
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    args.genesisForkId
                );
            if (!genesis)
                throw new Error(`No genesis stored for ${args.genesisForkId}`);
            const data = genesis.toStruct().snapshotData;
            const walks = [];
            for await (const walk of sm.agreementManager.walkStateProofTiers(
                args.forkId,
                { milestones: [] },
                {
                    genesisStateSnapshotData: {
                        ...data,
                        originForkId: args.originForkId ?? data.originForkId
                    },
                    milestoneSnapshots: []
                }
            ))
                walks.push({
                    tier: String(walk.tier),
                    valid: walk.valid,
                    startForkId: walk.start ? String(walk.start.forkID) : null
                });
            return walks;
        },
        {
            forkId: options.forkId,
            genesisForkId: options.genesisForkId,
            originForkId: options.originForkId ?? null
        }
    );
}

/** The heights `from`..`to`, both included. */
export function heightRange(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The signers of `blocks` together cover every address of `required`. */
export function coversAll(blocks: string[][], required: string[]): boolean {
    const signers = new Set(blocks.flat());
    return required.every((address) => signers.has(address));
}

/** The previous and resulting participants of milestone `i`'s hop. */
export function hopUnion(view: BuiltProofView, i: number): string[] {
    const previous =
        i === 0 ? view.startParticipants : view.milestoneParticipants[i - 1];
    return [...new Set([...previous, ...view.milestoneParticipants[i]])];
}

/** Advance the real anchor after a walk starts, before the verifier reads its state. */
export async function walkAcrossAnchorAdvance(
    h: MathPeerTestHarness,
    tier: "chain" | "localDiamond"
) {
    await stageFinalBlocks(h, { postAnchor: true, finalBlocks: 2 });
    return h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            const am = sm.agreementManager;
            const forkId = sm.forkId;
            const contract =
                args.tier === "chain"
                    ? sm.stateChannelManagerContract
                    : sm.diamondStateMachine.localDiamondContract;
            const proof = {
                milestones: [
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock: "0x",
                                    signature: "0x"
                                },
                                signatures: []
                            },
                            sm.storage.blocks.getBlock(forkId, 2)!
                                .blockConfirmationStruct
                        ]
                    },
                    {
                        blockConfirmations: [
                            sm.storage.blocks.getBlock(forkId, 3)!
                                .blockConfirmationStruct
                        ]
                    }
                ]
            };
            const evidence = am.getStoredEvidence(forkId, proof);
            const method = contract.getFunction("verifyMilestones");
            const original = method.staticCall;
            const held = async (...callArgs: Parameters<typeof original>) => {
                await sm.snapshotUpdateService.postStateSnapshotWait(forkId);
                return original(...callArgs);
            };
            const replacement = Object.defineProperties(
                (...callArgs: Parameters<typeof method>) => method(...callArgs),
                {
                    ...Object.getOwnPropertyDescriptors(method),
                    staticCall: { value: held, configurable: true }
                }
            );
            Object.defineProperty(contract, "verifyMilestones", {
                value: replacement,
                configurable: true
            });
            try {
                let walk;
                if (args.tier === "chain")
                    walk = await am.walkFromChainAnchor(
                        forkId,
                        proof,
                        evidence
                    );
                else
                    for await (const candidate of am.walkStateProofTiers(
                        forkId,
                        proof,
                        evidence
                    )) {
                        if (candidate.tier === "localDiamond") {
                            walk = candidate;
                            break;
                        }
                    }
                if (!walk)
                    throw new Error("The selected walk tier was not reached");
                const persisted = am.persistVerifiedProof(
                    proof,
                    evidence,
                    walk
                );
                return {
                    valid: walk.valid,
                    start: walk.start?.blockHeight,
                    final: walk.finalizedSnapshot.blockHeight,
                    persisted
                };
            } finally {
                Reflect.deleteProperty(contract, "verifyMilestones");
            }
        },
        { tier }
    );
}

/** Exact-point construction and its canonical verdict, projected without moving the view. */
export async function exactFinalProofView(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const before = sm.storage.blocks.getNextBlockHeight(sm.forkId);
            const proof = await am.tryBuildFinalProofAt(sm.forkId, args.height);
            const after = sm.storage.blocks.getNextBlockHeight(sm.forkId);
            if (!proof) return { before, after, proof: null };
            const walk =
                await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                    proof
                );
            return {
                before,
                after,
                proof: {
                    valid: walk.valid,
                    start: Number(walk.startSnapshot.blockHeight),
                    usedNonGenesisStart: walk.usedNonGenesisStart,
                    finalHeight: Number(walk.finalizedSnapshot.blockHeight),
                    milestones: proof.stateProof.milestones.map((milestone) =>
                        milestone.blockConfirmations.map((confirmation) => {
                            const block = am.getLastBlockFromMilestone({
                                blockConfirmations: [confirmation]
                            })!;
                            return {
                                height: block.height,
                                signers: [...block.allSignerAddresses]
                            };
                        })
                    ),
                    participants: proof.milestoneSnapshots.map((snapshot) => [
                        ...snapshot.snapshotData.participants
                    ])
                }
            };
        },
        { height }
    );
}

/** A join needs the offline member's sole confirmation on a later real block. */
export async function stageExactJoinWithLaterVote(h: MathPeerTestHarness) {
    const staged = await stageFinalJoinThenUnfinalizedTail(h, {
        offlineConfirmsJoin: true
    });
    const { observerIndex, offlineIndex, forkId, joinHeight, latestHeight } =
        staged;
    await h
        .control(h.getPeer(observerIndex))
        .stub.stripStoredBlockSignature(
            forkId,
            joinHeight,
            h.getPeer(offlineIndex).address
        )
        .request();
    await addStoredSignature(h, observerIndex, latestHeight, offlineIndex);
    return staged;
}

/** The exit stays off chain; a remaining member supplies its missing vote one block later. */
export async function stageExactExitWithLaterVote(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({ peerCount: 3, transitionCount: 2 });
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const leaver = await h.query.getNextPeerToWrite();
    const exitPost = await h.rpcStub.holdSnapshotPostSend(leaver.index);
    try {
        await h.dispute.suppressDisputeInitiation([leaver.index]);
        const remaining = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== leaver.index);
        await h.transition.participantLeaveStateTransition({
            leaverIndex: leaver.index,
            waitForPeers: remaining
        });
        const observerIndex = remaining[0];
        const query = h.control(h.getPeer(observerIndex)).query;
        const forkId = h.activeForkId!;
        const finalHeight = Number(
            await query.getLatestBlockHeight(forkId).request()
        );
        const nextAuthor = await query.getNextToWrite().request();
        const voterIndex = remaining.find(
            (index) => h.getPeer(index).address !== nextAuthor
        )!;
        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        await h
            .control(h.getPeer(observerIndex))
            .stub.stripStoredBlockSignature(
                forkId,
                finalHeight,
                h.getPeer(voterIndex).address
            )
            .request();
        return {
            observerIndex,
            voterIndex,
            leaverIndex: leaver.index,
            forkId,
            finalHeight,
            supportHeight: finalHeight + 1,
            releaseExitPost: exitPost.release
        };
    } catch (error) {
        await exitPost.release();
        throw error;
    }
}

/** Audit a real join proof above a spectator's older installed view. */
export async function stageExactJoinAboveView(h: MathPeerTestHarness) {
    let encodedSyncPayload = "";
    const staged = await stageJoinHopWithLaterFinalPoint(h, {
        postAnchor: false,
        beforeJoin: async () => {
            const served = await h
                .control(h.getPeer(0))
                .spectate.generateSyncPayload(h.channelId, h.activeForkId!, 0)
                .request();
            if (!served)
                throw new Error("The pre-join sync payload is missing");
            encodedSyncPayload = served.encodedSyncPayload;
        }
    });
    // Exercise the fallback boundary: the real post happened, but its
    // subscribed delivery must not teach the missing signer another block.
    await h
        .control(h.getPeer(staged.observerIndex))
        .stub.waitForHeldCalldataPostedEvent()
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    const spectator = await syncSpectatorOnServedPayload(
        h,
        encodedSyncPayload,
        [0, 1, 2],
        [],
        async (peer) => {
            await h.rpcStub.dropNetworkConfirmations(peer.index);
        }
    );
    const before = Number(
        await h
            .control(spectator)
            .query.getNextBlockHeight(staged.forkId)
            .request()
    );
    await h
        .control(h.getPeer(staged.observerIndex))
        .dispute.setForceExit(true)
        .request();
    const built = await h.dispute.fetchConstructedDispute(staged.observerIndex);
    expect(
        built.dispute.input.stateProof.milestones.map((milestone) =>
            milestone.blockConfirmations.map(
                (confirmation) =>
                    Block.fromBlockConfirmation(confirmation).height
            )
        ),
        "the served proof still has the join hop and later virtual-final point"
    ).to.deep.equal([
        heightRange(staged.joinHeight, staged.latestHeight),
        [staged.latestHeight - 1, staged.latestHeight]
    ]);
    const audit = await h.dispute.auditDispute(
        spectator.index,
        built.dispute,
        built.auditingData
    );
    expect(audit.outcome, "the real proof is audited successfully").to.equal(
        "returned"
    );
    if (audit.outcome === "returned") expect(audit.isValid).to.equal(true);
    expect(audit.storedProof).to.equal(undefined);
    const after = Number(
        await h
            .control(spectator)
            .query.getNextBlockHeight(staged.forkId)
            .request()
    );
    expect(
        after,
        "audit persistence leaves the installed view unchanged"
    ).to.equal(before);
    expect(before, "the join evidence is above the frozen view").to.be.at.most(
        staged.joinHeight
    );
    return {
        ...staged,
        auditorIndex: spectator.index,
        frozenNextHeight: before
    };
}
