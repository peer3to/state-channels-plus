// @spec-test-coverage-ignore: sync completion and verified persistence staging exercised by explicit SpectateService declarations
import { craftProofBlock } from "./DisputeAuditStaging";
import {
    stageForgedUnfinalTailPayload,
    withHeldFreshRequester
} from "./HistoricSyncStaging";
import {
    constructProof,
    postSnapshotAt
} from "./StateProofConstructionStaging";
import { Block, StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import type { Address, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;
type SnapshotStruct = SyncPayload["milestoneSnapshots"][number];

/** A stored block: its hash and every signer (author included), sorted. */
export type StoredBlockProjection = { hash: string; signers: string[] };

/** What a fresh requester's storage is asked for after its sync attempts. */
export type SyncInspection = {
    /** heights whose stored block is projected (null when not stored) */
    heights?: number[];
    snapshotHashes?: string[];
    stateHashes?: string[];
};

export type FreshSyncOptions = {
    /**
     * The first tail block replay meets an executor fault, so the apply
     * stops before its own replay. The requester ignores calldata-posted
     * events meanwhile: their local transaction, run by the event sync once
     * the sync installs its state, would take the one-shot fault instead.
     */
    failTailReplay?: boolean;
    /** Record the requester's tier-one walk and its storage-tier walk. */
    observeWalks?: boolean;
    /** Rebuild the requester's own proof after the applies and walk it on chain. */
    reconstruct?: boolean;
    inspect?: SyncInspection;
};

/** The heights of each milestone's blocks. */
export function proofHeights(payload: SyncPayload): number[][] {
    return payload.stateProof.milestones.map((milestone) =>
        milestone.blockConfirmations.map(
            (confirmation) => Block.fromBlockConfirmation(confirmation).height
        )
    );
}

/**
 * `responder`'s payload for `forkId` at `height` (default: its head), built
 * by its real generator.
 */
export async function servedPayload(
    h: MathPeerTestHarness,
    responder: Peer,
    forkId: ForkId,
    height?: number
): Promise<SyncPayload> {
    const control = h.control(responder);
    const requested =
        height ?? (await control.query.getLatestBlockHeight(forkId).request());
    const served = await control.spectate
        .generateSyncPayload(h.channelId, forkId, requested!)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    expect(served, "the responder serves a payload").to.not.equal(null);
    return Codec.decode(served!.encodedSyncPayload, Type.SyncPayload);
}

/** The peer's stored blocks at `heights`, or null where none is stored. */
export async function storedBlocks(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: string,
    heights: number[]
): Promise<(StoredBlockProjection | null)[]> {
    const query = h.control(peer).query;
    return await Promise.all(
        heights.map(async (height) => {
            const bundle = await query
                .getBlockByHeight(forkId, height)
                .request();
            return (
                bundle && {
                    hash: bundle.hash,
                    signers: [
                        bundle.author,
                        ...bundle.confirmationSignerAddresses
                    ].sort()
                }
            );
        })
    );
}

/**
 * A held fresh requester (no local history or final point) applies each
 * payload from peer 0 in order through the real `applySyncResponse`, in one
 * host call; `"served"` is peer 0's answer to a real spectate request pinned
 * to `forkId`. Returns per payload the verdict (or the thrown message), the
 * served payload, the rejections and the responder blacklist, then the
 * requester's head, the hash of the state its machine holds, the
 * inspected storage and its participant-set change heights.
 */
export async function syncOnFreshRequester(
    h: MathPeerTestHarness,
    forkId: string,
    payloads: (SyncPayload | "served")[],
    options: FreshSyncOptions = {}
) {
    const responder = h.getPeer(0);
    const {
        heights = [],
        snapshotHashes = [],
        stateHashes = []
    } = options.inspect ?? {};
    return await withHeldFreshRequester(h, async (requester) => {
        const control = h.control(requester);
        await control.stub.recordSyncRejections().request();
        const walks = options.observeWalks
            ? {
                  trustedStart: await h.mirror.observe(
                      requester.index,
                      "verifyMilestonesFromTrustedStart"
                  ),
                  storage: await h.mirror.observe(
                      requester.index,
                      "verifyMilestones"
                  )
              }
            : undefined;
        try {
            if (options.failTailReplay) {
                await control.stub.stubCalldataPosting().request();
                await control.stub.failNextBlockReplay().request();
            }
            const applied = await h.execOnHost(
                requester,
                async (sm, a) => {
                    const service = sm.p2pManager.localRpc.spectateService;
                    const request = {
                        channelId: sm.channelId,
                        forkId: a.forkId
                    };
                    let servedEncoded: string | null = null;
                    const outcomes: { accepted: boolean; threw: string }[] = [];
                    for (const payload of a.encodedPayloads) {
                        let encoded = payload;
                        if (encoded === null) {
                            const response =
                                await sm.p2pManager.remoteRpc.spectateService
                                    .onSpectateRequest(request)
                                    .request(a.responder);
                            encoded = String(response.encodedSyncPayload);
                            servedEncoded = encoded;
                        }
                        try {
                            // the prototype method: the held initial sync stays held
                            const accepted: boolean =
                                await Object.getPrototypeOf(
                                    service
                                ).applySyncResponse.call(
                                    service,
                                    a.responder,
                                    request,
                                    encoded
                                );
                            outcomes.push({ accepted, threw: "" });
                        } catch (error) {
                            outcomes.push({
                                accepted: false,
                                threw: String(error)
                            });
                        }
                    }
                    return { outcomes, servedEncoded };
                },
                {
                    responder: responder.address,
                    forkId,
                    encodedPayloads: payloads.map((payload) =>
                        payload === "served"
                            ? null
                            : (Codec.encode(
                                  payload,
                                  Type.SyncPayload
                              ) as string)
                    )
                },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            const persisted = await h.execOnHost(
                requester,
                async (sm, a, { ethers }) => ({
                    head: sm.storage.blocks.getNextBlockHeight(a.forkId) - 1,
                    installedStateHash: ethers.keccak256(
                        await sm.diamondStateMachine.getState()
                    ),
                    snapshotsStored: a.snapshotHashes.map(
                        (snapshotHash) =>
                            !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                                snapshotHash
                            )
                    ),
                    statesStored: a.stateHashes.map(
                        (stateHash) =>
                            !!sm.storage.stateMachineStates.getStateMachineState(
                                stateHash
                            )
                    )
                }),
                { forkId, snapshotHashes, stateHashes }
            );
            return {
                outcomes: applied.outcomes,
                served:
                    applied.servedEncoded === null
                        ? null
                        : Codec.decode(applied.servedEncoded, Type.SyncPayload),
                rejections: await control.stub
                    .restoreRecordedSyncRejections()
                    .request(),
                blacklisted: await control.query
                    .isBlacklisted(responder.address)
                    .request(),
                ...persisted,
                changeHeights: await control.query
                    .getParticipantChangeHeights(forkId)
                    .request(),
                blocks: await storedBlocks(h, requester, forkId, heights),
                walks: walks && {
                    trustedStart: await walks.trustedStart.observation(),
                    storage: await walks.storage.observation()
                },
                rebuilt: options.reconstruct
                    ? await constructProof(h, requester.index)
                    : undefined
            };
        } finally {
            await walks?.trustedStart.restore();
            await walks?.storage.restore();
            await control.stub.restoreRecordedSyncRejections().request();
            if (options.failTailReplay)
                await control.stub.restoreCalldataPosting().request();
        }
    });
}

/**
 * Every running peer serves `payload` and a fresh spectator runs its real
 * initial sync to SYNCED; the peers serve honestly again after it.
 */
export async function syncSpectatorOnServedPayload(
    h: MathPeerTestHarness,
    payload: SyncPayload
): Promise<Peer> {
    const encoded = Codec.encode(payload, Type.SyncPayload) as string;
    const servers = h.peers.filter(
        (peer) => !runtimeIsClosed(peer.p2pInstance)
    );
    try {
        for (const peer of servers)
            await h.control(peer).stub.stubSpectatePayload(encoded).request();
        return h.getPeer((await h.join.addSpectatorWait()).index);
    } finally {
        for (const peer of servers)
            await h.control(peer).stub.restoreSpectateStaleProof().request();
    }
}

/**
 * Three participants and blocks 0..2; peer 0 posts the snapshot of block 2
 * (the anchor), then `blocksAfter` blocks follow: final, or with `cutPeer`
 * authored by peers 0 and 1 after peer 2 is cut off, so they stay unfinal
 * (their timeout checks are suppressed: peer 2's idle writer slot would open
 * a participant-timeout dispute). Returns the anchor and peer 0's payload for
 * its tip.
 */
export async function stageAnchoredHistory(
    h: MathPeerTestHarness,
    options: { blocksAfter: number; cutPeer?: boolean }
) {
    if (options.cutPeer) {
        await h.lifecycle.start(3, 3, {
            timeConfig: { chainFallbackTime: 60 }
        });
        for (const index of [0, 1]) await h.rpcStub.suppressTimeoutCheck(index);
    } else await h.lifecycle.start(3, 3);
    const forkId = String(h.activeForkId!);
    const responder = h.getPeer(0);
    const anchor = await postSnapshotAt(h, responder.index, 2);
    if (options.cutPeer) {
        await h.network.blacklistAndDisconnectPeer(2);
        await h.transition.advanceState({
            count: options.blocksAfter,
            waitForPeers: [0, 1]
        });
    } else if (options.blocksAfter > 0)
        await h.transition.advanceState({
            count: options.blocksAfter,
            waitForFinalization: true
        });
    const latestHeight = (await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    expect(latestHeight).to.equal(anchor.blockHeight + options.blocksAfter);
    return {
        forkId,
        responder,
        anchor,
        latestHeight,
        payload: await servedPayload(h, responder, forkId, latestHeight)
    };
}

/** Peer 0's stored block at `height`: its confirmation, author and committed snapshot. */
async function servedBlock(
    h: MathPeerTestHarness,
    forkId: string,
    height: number
) {
    const query = h.control(h.getPeer(0)).query;
    const bundle = (await query.getBlockByHeight(forkId, height).request())!;
    const snapshot = (await query
        .getStateSnapshotStructByHash(bundle.stateSnapshotHash)
        .request())!;
    return {
        hash: bundle.hash,
        author: bundle.author,
        confirmation: Codec.decode(
            bundle.encodedBlockConfirmation,
            Type.BlockConfirmation
        ),
        snapshot: Codec.decode(snapshot.encodedSnapshot, Type.StateSnapshot)
    };
}

/** Peer 0's encoded state that `snapshot` commits. */
async function servedState(
    h: MathPeerTestHarness,
    snapshot: SnapshotStruct
): Promise<string> {
    const state = await h
        .control(h.getPeer(0))
        .query.getStateMachineState(
            StateSnapshot.from(snapshot).stateMachineStateHash
        )
        .request();
    expect(state).to.not.equal(null);
    return state!;
}

/** `confirmation` with only the confirmation signatures of `signers`. */
function keepSignatures(
    confirmation: BlockConfirmationStruct,
    signers: Address[]
): BlockConfirmationStruct {
    const block = Block.fromBlockConfirmation(confirmation);
    return {
        signedBlock: confirmation.signedBlock,
        signatures: confirmation.signatures.filter((signature) =>
            signers.includes(block.signatureToAddress(signature as string))
        )
    };
}

/** `snapshot` one second later: a copy no block commits. */
function retimed(snapshot: SnapshotStruct): SnapshotStruct {
    return { ...snapshot, timestamp: BigInt(snapshot.timestamp) + 1n };
}

/** A copy of `payload` serving `milestones`, their snapshots and `encodedState`. */
function servingProof(
    payload: SyncPayload,
    milestones: BlockConfirmationStruct[][],
    milestoneSnapshots: SnapshotStruct[],
    encodedState: SyncPayload["latestFinalizedEncodedState"]
): SyncPayload {
    return {
        ...Codec.decode(
            Codec.encode(payload, Type.SyncPayload),
            Type.SyncPayload
        ),
        stateProof: {
            milestones: milestones.map((blockConfirmations) => ({
                blockConfirmations
            }))
        },
        milestoneSnapshots,
        latestFinalizedEncodedState: encodedState
    };
}

/** The distinct authors of `first` and `second`, then the remaining participant. */
function authorsOf(
    h: MathPeerTestHarness,
    first: { author: string },
    second: { author: string }
) {
    expect(first.author).to.not.equal(second.author);
    const third = [0, 1, 2]
        .map((index) => h.getPeer(index).address)
        .find(
            (address) => address !== first.author && address !== second.author
        )!;
    return [first.author, second.author, third];
}

/**
 * `stageAnchoredHistory` with four final blocks a+1..a+4 above the anchor a,
 * served as two separated threshold milestones [a+1, a+2] and [a+4]: a+1
 * keeps its author A and B's signature, a+2 its author B and C's signature,
 * so C's signature on a+2 is indispensable to a+1's threshold. a+3 is never
 * served; the served state is a+4's.
 */
export async function stageSeparatedEvidencePayload(h: MathPeerTestHarness) {
    const staged = await stageAnchoredHistory(h, { blocksAfter: 4 });
    const { forkId, anchor, latestHeight, payload } = staged;
    expect(proofHeights(payload)).to.deep.equal([[latestHeight]]);
    const first = await servedBlock(h, forkId, anchor.blockHeight + 1);
    const support = await servedBlock(h, forkId, anchor.blockHeight + 2);
    const [a, b, c] = authorsOf(h, first, support);
    return {
        ...staged,
        payload: servingProof(
            payload,
            [
                [
                    keepSignatures(first.confirmation, [b]),
                    keepSignatures(support.confirmation, [c])
                ],
                payload.stateProof.milestones[0].blockConfirmations
            ],
            [first.snapshot, payload.milestoneSnapshots[0]],
            payload.latestFinalizedEncodedState
        ),
        first: {
            height: anchor.blockHeight + 1,
            block: { hash: first.hash, signers: [a, b].sort() }
        },
        support: {
            height: anchor.blockHeight + 2,
            block: { hash: support.hash, signers: [b, c].sort() },
            snapshot: StateSnapshot.from(support.snapshot)
        },
        gapHeight: anchor.blockHeight + 3
    };
}

/**
 * `stageAnchoredHistory` with three final blocks a+1 (author A), a+2 (B) and
 * a+3 (C) served as [a+1 with B's signature, a+2 with C's] and [a+2 with A's
 * signature, a+3 author-signed only]: neither occurrence of a+2 carries every
 * signature, together they do. The served state is a+2's, so a+3 is the
 * replay tail.
 */
export async function stageMergedSignaturePayload(h: MathPeerTestHarness) {
    const staged = await stageAnchoredHistory(h, { blocksAfter: 3 });
    const { forkId, anchor, latestHeight, payload } = staged;
    expect(proofHeights(payload)).to.deep.equal([[latestHeight]]);
    const first = await servedBlock(h, forkId, anchor.blockHeight + 1);
    const support = await servedBlock(h, forkId, anchor.blockHeight + 2);
    const tail = await servedBlock(h, forkId, latestHeight);
    const [a, b, c] = authorsOf(h, first, support);
    expect(tail.author).to.equal(c);
    return {
        ...staged,
        payload: servingProof(
            payload,
            [
                [
                    keepSignatures(first.confirmation, [b]),
                    keepSignatures(support.confirmation, [c])
                ],
                [
                    keepSignatures(support.confirmation, [a]),
                    keepSignatures(tail.confirmation, [])
                ]
            ],
            [first.snapshot, support.snapshot],
            await servedState(h, support.snapshot)
        ),
        first: {
            height: anchor.blockHeight + 1,
            block: { hash: first.hash, signers: [a, b].sort() }
        },
        support: {
            height: anchor.blockHeight + 2,
            block: { hash: support.hash, signers: [a, b, c].sort() }
        },
        tail: { height: latestHeight, hash: tail.hash }
    };
}

/**
 * `stageAnchoredHistory` (final blocks), then one run of peer 0's stored
 * blocks from anchor+`first` to anchor+`last` served with the anchor's state.
 * The run's milestone snapshot is the one its first block commits, re-timed
 * when `forgeSnapshot` (a supplied snapshot no block commits).
 */
export async function stageServedRunPayload(
    h: MathPeerTestHarness,
    options: {
        blocksAfter: number;
        first: number;
        last: number;
        forgeSnapshot?: boolean;
    }
) {
    const staged = await stageAnchoredHistory(h, {
        blocksAfter: options.blocksAfter
    });
    const { forkId, anchor, payload } = staged;
    const run: Awaited<ReturnType<typeof servedBlock>>[] = [];
    for (let offset = options.first; offset <= options.last; offset++)
        run.push(await servedBlock(h, forkId, anchor.blockHeight + offset));
    const supplied = options.forgeSnapshot
        ? retimed(run[0].snapshot)
        : run[0].snapshot;
    return {
        ...staged,
        payload: servingProof(
            payload,
            [run.map((block) => block.confirmation)],
            [supplied],
            await servedState(h, anchor.toStruct())
        ),
        suppliedSnapshotHash: String(StateSnapshot.from(supplied).hash)
    };
}

/**
 * `stageServedRunPayload` for the run anchor..tip, with a forged block put
 * in front of it at anchor-1: authored by peer 0 with no confirmation,
 * linked to nothing, committing a copy of the anchor moved to that height
 * without peer 2 (a participant-set change). That copy is the run's supplied
 * snapshot. The walk checks the run only from the anchor up.
 */
export async function stageForgedBlockBelowAnchorInRun(h: MathPeerTestHarness) {
    const staged = await stageServedRunPayload(h, {
        blocksAfter: 2,
        first: 0,
        last: 2
    });
    const { forkId, anchor, payload } = staged;
    const height = anchor.blockHeight - 1;
    const anchorStruct = anchor.toStruct();
    const snapshot = StateSnapshot.from({
        ...anchorStruct,
        blockHeight: height,
        snapshotData: {
            ...anchorStruct.snapshotData,
            participants: anchorStruct.snapshotData.participants.filter(
                (participant) => participant !== h.getPeer(2).address
            )
        }
    });
    expect(snapshot.snapshotData.participants).to.have.length(2);
    const forged = await craftProofBlock(h, {
        authorIndex: 0,
        forkId,
        height,
        stateSnapshotHash: snapshot.hash
    });
    payload.stateProof.milestones[0].blockConfirmations.unshift({
        signedBlock: forged.signedBlock,
        signatures: []
    });
    payload.milestoneSnapshots[0] = snapshot.toStruct();
    return {
        ...staged,
        forged: {
            height,
            blockHash: String(forged.block.hash),
            snapshotHash: String(snapshot.hash)
        }
    };
}

/**
 * A one-block milestone prepended to `payload` below the anchor: a block
 * authored by peer 0 at `height`, linked to nothing, committing a copy of
 * the first milestone snapshot moved to that height. Returns the forged block
 * and snapshot hashes.
 */
export async function prependForgedHeightMilestone(
    h: MathPeerTestHarness,
    forkId: string,
    payload: SyncPayload,
    height: number
) {
    const snapshot = StateSnapshot.from({
        ...payload.milestoneSnapshots[0],
        blockHeight: height
    });
    const forged = await craftProofBlock(h, {
        authorIndex: 0,
        forkId,
        height,
        stateSnapshotHash: snapshot.hash
    });
    payload.stateProof.milestones.unshift({
        blockConfirmations: [
            { signedBlock: forged.signedBlock, signatures: [] }
        ]
    });
    payload.milestoneSnapshots.unshift(snapshot.toStruct());
    return {
        blockHash: String(forged.block.hash),
        snapshotHash: String(snapshot.hash)
    };
}

/**
 * `stageForgedUnfinalTailPayload`, its one milestone [k, k+1, ...] served
 * twice: the first occurrence is threshold support, the second carries the
 * replay tail. Returns the honest and forged repetitions, the run heights
 * with the honest stored blocks, and the forged tail block.
 */
export async function stageRepeatedTailPayloads(h: MathPeerTestHarness) {
    const staged = await stageForgedUnfinalTailPayload(h);
    const repeat = (payload: SyncPayload): SyncPayload => {
        const copy = Codec.decode(
            Codec.encode(payload, Type.SyncPayload),
            Type.SyncPayload
        );
        expect(copy.stateProof.milestones).to.have.length(1);
        copy.stateProof.milestones.push(copy.stateProof.milestones[0]);
        copy.milestoneSnapshots.push(copy.milestoneSnapshots[0]);
        return copy;
    };
    const runHeights = proofHeights(staged.payload)[0];
    const forgedTail = Block.fromBlockConfirmation(
        staged.forged.stateProof.milestones[0].blockConfirmations.at(-1)!
    );
    return {
        ...staged,
        repeated: repeat(staged.payload),
        repeatedForged: repeat(staged.forged),
        runHeights,
        runBlocks: await storedBlocks(
            h,
            staged.responder,
            staged.forkId,
            runHeights
        ),
        forgedTail: { height: forgedTail.height, hash: forgedTail.hash }
    };
}
