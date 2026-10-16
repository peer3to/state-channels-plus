// @spec-test-coverage-ignore: sync proof verification, persistence and reconstruction staging exercised by explicit SpectateSyncProofStart and SyncReconstruction declarations
import { Block, StateSnapshot } from "@/models";
import { Status, type SyncPayload } from "@/types";
import type { Address, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { buildAndEncodeBlock, hash as randomHash } from "@test/factory";
import { LOCAL_WALK } from "@test/fixtures/customRpc/harnessControl/services/mirror/MirrorService";
import type { BlockBundle } from "@test/fixtures/customRpc/harnessControl/services/query/QueryRpcMethods";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    chainSnapshot,
    proofHeights,
    servedPayload
} from "@test/fixtures/MilestoneSyncStaging";
import { postAnchor } from "@test/fixtures/ProofOwnerStaging";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { getBytes, Wallet } from "ethers";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;
type SnapshotStruct = SyncPayload["milestoneSnapshots"][number];
type ConfirmationStruct =
    SyncPayload["stateProof"]["milestones"][number]["blockConfirmations"][number];

/** Requesters whose runtime an apply saw disposed (a spectator abort). */
const disposedRequesters = new WeakSet<Peer>();

/** Whether `requester`'s runtime is gone, so no host call reaches it. */
function isRequesterGone(requester: Peer): boolean {
    return (
        disposedRequesters.has(requester) ||
        runtimeIsClosed(requester.p2pInstance)
    );
}

/** A stored block: its hash and every signer (author included), sorted. */
export type StoredBlockProjection = { hash: string; signers: string[] };

/** What a requester's storage is asked for after its applies. */
export type SyncInspection = {
    /** heights whose stored block is projected (null when not stored) */
    heights?: number[];
    /** heights whose retained evidence blocks are projected */
    retainedHeights?: number[];
    snapshotHashes?: string[];
    stateHashes?: string[];
};

/** A one-shot fault on one tier's walk of the requester. */
export type TierWalkFault =
    /** the local finalized tier: the trusted-start walk on the local diamond */
    | "localFinalized"
    /** the local diamond tier: `verifyMilestones` on the local diamond */
    | "localDiamond"
    /** the chain tier: `verifyMilestones` sent to a refusing RPC endpoint */
    | "chain";

export type ApplyOptions = {
    /** the responder the requester applies the payloads from (default peer 0) */
    responderIndex?: number;
    /** per payload, the responder it is applied from (default `responderIndex`) */
    payloadResponderIndices?: number[];
    /** Record the requester's trusted-start walks and its `verifyMilestones` walks. */
    observeWalks?: boolean;
    /** The tier's next walk fails at its connection (implies `observeWalks`). */
    walkFault?: TierWalkFault;
    /** Rebuild the requester's own proof after the applies and walk it on chain. */
    reconstruct?: boolean;
    /** The height `reconstruct` rebuilds through (default: the head). */
    reconstructHeight?: number;
    /** Read the requester's local finalized height after each apply (a trusted-start walk). */
    readLocalFinality?: boolean;
    inspect?: SyncInspection;
};

export type FreshApplyOptions = ApplyOptions & {
    /** Runs once the fresh requester is held, before the first payload is applied. */
    beforeApply?: (requester: Peer) => Promise<void>;
};

/**
 * The blocks `payload` serves, as they would be stored from it alone: per
 * proof height its hash and every signer (author included), sorted.
 */
export function servedProjections(
    payload: SyncPayload,
    heights: number[]
): (StoredBlockProjection | null)[] {
    const byHeight = new Map<number, StoredBlockProjection>();
    for (const milestone of payload.stateProof.milestones)
        for (const confirmation of milestone.blockConfirmations) {
            const block = Block.fromBlockConfirmation(confirmation);
            byHeight.set(block.height, {
                hash: String(block.hash),
                signers: [
                    String(block.author),
                    ...[...block.confirmationSignerAddresses].map(String)
                ].sort()
            });
        }
    return heights.map((height) => byHeight.get(height) ?? null);
}

/** A deep copy of `payload`, to alter without touching the original. */
function copyPayload(payload: SyncPayload): SyncPayload {
    return Codec.decode(
        Codec.encode(payload, Type.SyncPayload),
        Type.SyncPayload
    );
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
            return bundle && projectBlock(bundle);
        })
    );
}

/** The peer's retained proof evidence at `heights`: per height its blocks, sorted by hash. */
export async function retainedBlocks(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: string,
    heights: number[]
): Promise<StoredBlockProjection[][]> {
    const query = h.control(peer).query;
    return await Promise.all(
        heights.map(async (height) =>
            (await query.getRetainedEvidenceAt(forkId, height).request())
                .map(projectBlock)
                .sort((a, b) => a.hash.localeCompare(b.hash))
        )
    );
}

function projectBlock(bundle: BlockBundle): StoredBlockProjection {
    return {
        hash: bundle.hash,
        signers: [bundle.author, ...bundle.confirmationSignerAddresses].sort()
    };
}

/** `peerIndex` posts its latest final snapshot; the chain then holds it at `expectedHeight`. */
export async function postSnapshotAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    expectedHeight: number
): Promise<StateSnapshot> {
    const forkId = String(h.activeForkId!);
    await h.transition.postSnapshotWait({ peerIndex, forkId });
    const onChain = await chainSnapshot(h);
    expect(onChain.blockHeight).to.equal(expectedHeight);
    return onChain;
}

/**
 * The peer's own proof through `blockHeight` (default: its head), built by
 * `AgreementManager.buildStateProof` from its local diamond's anchor and
 * walked by the chain.
 */
export async function constructProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    blockHeight?: number
) {
    const result = await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const forkId = sm.forkId;
            const height =
                args.blockHeight ??
                sm.storage.blocks.getLatestBlockHeight(forkId);
            try {
                const built = await am.buildStateProof(forkId, height);
                const chain =
                    await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                        {
                            channelId: sm.channelId,
                            forkId,
                            stateProof: built.stateProof,
                            genesisStateSnapshotData:
                                built.evidence.genesisStateSnapshotData,
                            milestoneSnapshots:
                                built.evidence.milestoneSnapshots
                        }
                    );
                return {
                    requestedHeight: height,
                    startHeight: built.startSnapshot.blockHeight,
                    latestProofHeight:
                        am.getLatestBlockFromStateProof(built.stateProof)
                            ?.height ?? null,
                    // the heights of each milestone's blocks
                    milestones: built.stateProof.milestones.map((milestone) =>
                        milestone.blockConfirmations.map(
                            (confirmation) =>
                                am.getLastBlockFromMilestone({
                                    blockConfirmations: [confirmation]
                                })!.height
                        )
                    ),
                    chainValid: chain.valid,
                    finalizedSnapshotHash: String(built.finalizedSnapshot.hash)
                };
            } catch (error) {
                return String(error);
            }
        },
        { blockHeight: blockHeight ?? null }
    );
    if (typeof result === "string") throw new Error(result);
    return result;
}

/**
 * A fresh requester: a spectator peer connected to the channel whose own
 * initial sync is held at its application step, so it holds no history or
 * final point of its own while `run` drives it.
 */
export async function withHeldFreshRequester<T>(
    h: MathPeerTestHarness,
    run: (requester: Peer) => Promise<T>
): Promise<T> {
    const requester = h.getPeer((await h.join.createSpectatorPeer()).index);
    const stub = h.control(requester).stub;
    await stub.stubHoldSpectateSyncApplication().request();
    try {
        await h.join.connectSpectator(requester);
        await waitFor(
            async () =>
                (await stub.getHeldSpectateSyncApplicationCount().request()) >
                0,
            h.event.protocolEventTimeoutMs()
        );
        return await run(requester);
    } finally {
        // a spectator that aborted on provable fraud disposed its runtime
        if (!isRequesterGone(requester))
            await stub.restoreHoldSpectateSyncApplication().request();
    }
}

/**
 * A requester spawned before the channel opens, so its slow spawn never sits
 * between two blocks: an authoring window outlived by blocking setup ends in
 * a block whose capped timestamp is too old to accept. As a non-participant
 * present at the opening it is SYNCED at the genesis without an initial
 * sync. From before block 0 its gossip is either dropped (`"drop"`: it holds
 * no block or final point of its own) or its queue execution is held
 * (`"holdQueue"`: later blocks wait in its queue, but the next block in
 * order is still committed directly). Peers 0..2 then author `blockCount`
 * final blocks; `run` drives it, and every block authored from there on
 * must stay inside the authoring window. The staging is undone at the end
 * (`run` may release the queue hold earlier).
 */
export async function withEarlyHeldRequester<T>(
    h: MathPeerTestHarness,
    options: { blockCount: number; gossip: "drop" | "holdQueue" },
    run: (requester: Peer, forkId: string) => Promise<T>
): Promise<T> {
    await h.setup(4);
    const requester = h.getPeer(3);
    const stub = h.control(requester).stub;
    if (options.gossip === "drop")
        await stub.stubDropNetworkConfirmations().request();
    else await stub.holdBlockWork("queueDequeue").request();
    try {
        const forkId = String(
            await h.lifecycle.openChannelForParticipants([0, 1, 2])
        );
        await h.join.connectSpectator(requester);
        await h.event.waitUntilPeerStatus(requester.index, Status.SYNCED);
        await h.transition.advanceState({
            count: options.blockCount,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
        return await run(requester, forkId);
    } finally {
        if (options.gossip === "drop")
            await stub.restoreDropNetworkConfirmations().request();
        else await stub.releaseBlockWorkHold().request();
    }
}

/**
 * {@link applyPayloads} of peer 0's served payload on an early requester
 * (see {@link withEarlyHeldRequester}) whose gossip is dropped, after
 * three blocks; its local diamond then misses a consumed top-up
 * ({@link missConsumedTopUp}). With `anchor` peer 0 posts its final point as
 * the chain anchor before the top-up (every mirror holds it, so the
 * requester's anchor walk crosses the missed run) or after it (the requester
 * holds the snapshot event: its local diamond has no anchor and walks from
 * the genesis).
 */
export async function applyAfterMissedTopUp(
    h: MathPeerTestHarness,
    options: ApplyOptions & { anchor?: "beforeTopUp" | "afterTopUp" } = {}
) {
    return await withEarlyHeldRequester(
        h,
        { blockCount: 3, gossip: "drop" },
        async (requester, forkId) => {
            if (options.anchor === "beforeTopUp") await postAnchor(h);
            await missConsumedTopUp(h, requester);
            if (options.anchor === "afterTopUp")
                await postAnchor(h, { laggingIndices: [requester.index] });
            return await applyPayloads(
                h,
                requester,
                forkId,
                ["served"],
                options
            );
        }
    );
}

/**
 * `requester` applies each payload in order through the real
 * `applySyncResponse` (the prototype method, so a held initial sync stays
 * held), in one host call; `"served"` is the responder's answer to a real
 * spectate request pinned to `forkId`. Returns per payload the verdict or
 * the thrown message and the head after it; then the rejection reasons, the
 * responder blacklist, the head, the hash of the state the machine holds,
 * the inspected storage, the participant-set change heights, the observed
 * walks and the rebuilt proof.
 */
export async function applyPayloads(
    h: MathPeerTestHarness,
    requester: Peer,
    forkId: string,
    payloads: (SyncPayload | "served")[],
    options: ApplyOptions = {}
) {
    const responder = h.getPeer(options.responderIndex ?? 0);
    const {
        heights = [],
        retainedHeights = [],
        snapshotHashes = [],
        stateHashes = []
    } = options.inspect ?? {};
    const control = h.control(requester);
    await control.stub.recordSyncRejections().request();
    const observeWalks = options.observeWalks || !!options.walkFault;
    const walks = observeWalks
        ? {
              trustedStart: await h.mirror.observe(requester.index, LOCAL_WALK),
              storage: await h.mirror.observe(
                  requester.index,
                  "verifyMilestones"
              )
          }
        : undefined;
    try {
        if (options.walkFault === "localFinalized")
            await h.mirror.failNextLocalRead(
                requester.index,
                LOCAL_WALK,
                "transport"
            );
        if (options.walkFault === "localDiamond")
            await h.mirror.failNextLocalRead(
                requester.index,
                "verifyMilestones",
                "transport"
            );
        if (options.walkFault === "chain")
            await h.mirror.failNextChainRead(
                requester.index,
                "verifyMilestones",
                "transport"
            );
        const applied = await h.execOnHost(
            requester,
            async (sm, a) => {
                const service = sm.p2pManager.localRpc.spectateService;
                const request = { channelId: sm.channelId, forkId: a.forkId };
                let servedEncoded: string | null = null;
                const outcomes: {
                    accepted: boolean;
                    threw: string;
                    head: number;
                }[] = [];
                // per apply: installs of a latest state, struct replays, and
                // the local finalized height after it (record-only probes)
                const stateWrites: number[] = [];
                const replays: number[] = [];
                const localFinalizedHeights: (number | null)[] = [];
                const application = sm.stateApplicationService;
                const ingest = sm.blockIngestService;
                const install = application.unsafeSetLatestState;
                const replay = ingest.onBlockConfirmationStruct;
                let writes = 0;
                let replayed = 0;
                application.unsafeSetLatestState = (...args) => {
                    writes++;
                    return install.apply(application, args);
                };
                ingest.onBlockConfirmationStruct = (...args) => {
                    replayed++;
                    return replay.apply(ingest, args);
                };
                try {
                    for (const [
                        index,
                        payload
                    ] of a.encodedPayloads.entries()) {
                        const responder = a.payloadResponders[index];
                        let encoded = payload;
                        if (encoded === null) {
                            const response =
                                await sm.p2pManager.remoteRpc.spectateService
                                    .onSpectateRequest(request)
                                    .request(responder);
                            encoded = String(response.encodedSyncPayload);
                            servedEncoded = encoded;
                        }
                        writes = 0;
                        replayed = 0;
                        let accepted = false;
                        let threw = "";
                        try {
                            // the prototype method: a held initial sync stays held
                            accepted = await Object.getPrototypeOf(
                                service
                            ).applySyncResponse.call(
                                service,
                                responder,
                                request,
                                encoded
                            );
                        } catch (error) {
                            threw = String(error);
                        }
                        outcomes.push({
                            accepted,
                            threw,
                            head: sm.storage.blocks.getLatestBlockHeight(
                                a.forkId
                            )
                        });
                        stateWrites.push(writes);
                        replays.push(replayed);
                        localFinalizedHeights.push(
                            a.readLocalFinality
                                ? ((
                                      await sm.agreementManager.getLocalFinalizedSnapshot(
                                          a.forkId
                                      )
                                  )?.blockHeight ?? null)
                                : null
                        );
                    }
                } finally {
                    application.unsafeSetLatestState = install;
                    ingest.onBlockConfirmationStruct = replay;
                }
                // read here: a spectator that met provable fraud aborts and
                // disposes its runtime, so no later host call reaches it
                // `Hash` is typed `BytesLike`; the projection holds the hex string
                const project = (block: Block) => ({
                    hash: String(block.hash),
                    signers: [
                        block.author,
                        ...block.confirmationSignerAddresses
                    ].sort()
                });
                const storage = sm.storage;
                return {
                    outcomes,
                    stateWrites,
                    replays,
                    localFinalizedHeights,
                    servedEncoded,
                    disposed: sm.isDisposed,
                    blocks: a.heights.map((height) => {
                        const block = storage.blocks.getBlock(a.forkId, height);
                        return block ? project(block) : null;
                    }),
                    retained: a.retainedHeights.map((height) =>
                        storage.retainedEvidence
                            .getBlocks(a.forkId, height)
                            .map(project)
                            .sort((x, y) => x.hash.localeCompare(y.hash))
                    )
                };
            },
            {
                heights,
                retainedHeights,
                payloadResponders: payloads.map(
                    (_payload, index) =>
                        h.getPeer(
                            options.payloadResponderIndices?.[index] ??
                                responder.index
                        ).address
                ),
                forkId,
                readLocalFinality: !!options.readLocalFinality,
                encodedPayloads: payloads.map((payload) =>
                    payload === "served"
                        ? null
                        : (Codec.encode(payload, Type.SyncPayload) as string)
                )
            },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        const inspected = {
            outcomes: applied.outcomes,
            stateWrites: applied.stateWrites,
            replays: applied.replays,
            localFinalizedHeights: applied.localFinalizedHeights,
            served:
                applied.servedEncoded === null
                    ? null
                    : Codec.decode(applied.servedEncoded, Type.SyncPayload),
            disposed: applied.disposed,
            blocks: applied.blocks as (StoredBlockProjection | null)[],
            retained: applied.retained as StoredBlockProjection[][]
        };
        // an aborted spectator's runtime is gone: only what the apply read
        if (applied.disposed) disposedRequesters.add(requester);
        if (applied.disposed)
            return {
                ...inspected,
                rejections: null,
                blacklisted: null,
                head: applied.outcomes.at(-1)?.head ?? null,
                installedStateHash: null,
                snapshotsStored: [],
                statesStored: [],
                changeHeights: null,
                walks: undefined,
                rebuilt: undefined
            };
        const persisted = await h.execOnHost(
            requester,
            async (sm, a, { ethers }) => ({
                head: sm.storage.blocks.getLatestBlockHeight(a.forkId),
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
            ...inspected,
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
            walks: walks && {
                trustedStart: await walks.trustedStart.observation(),
                storage: await walks.storage.observation()
            },
            rebuilt: options.reconstruct
                ? await constructProof(
                      h,
                      requester.index,
                      options.reconstructHeight
                  )
                : undefined
        };
    } finally {
        // an aborted spectator's runtime is gone with its probes
        if (!isRequesterGone(requester)) {
            await walks?.trustedStart.restore();
            await walks?.storage.restore();
            await control.stub.restoreRecordedSyncRejections().request();
        }
    }
}

/** {@link applyPayloads} on a held fresh requester. */
export async function applyOnFreshRequester(
    h: MathPeerTestHarness,
    forkId: string,
    payloads: (SyncPayload | "served")[],
    options: FreshApplyOptions = {}
) {
    return await withHeldFreshRequester(h, async (requester) => {
        await options.beforeApply?.(requester);
        return await applyPayloads(h, requester, forkId, payloads, options);
    });
}

/**
 * Every running peer serves `payload` and a fresh spectator runs its real
 * initial sync to SYNCED; the peers serve honestly again after it.
 */
export async function syncSpectatorFromAllRunningPeers(
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
 * authored by peers 0 and 1 after peer 2 is cut off, so they stay unfinal.
 * With `cutPeer` every timeout check is suppressed (peer 2's idle writer
 * slot, and the blocks peer 2 never receives, would open participant-timeout
 * disputes) and peers 0 and 1 do not post their unfinal blocks on chain.
 * Returns the anchor and peer 0's payload for its tip.
 */
export async function stageAnchoredHistory(
    h: MathPeerTestHarness,
    options: { blocksAfter: number; cutPeer?: boolean; p2pTime?: number }
) {
    await h.lifecycle.start(3, 3, {
        ...(options.p2pTime === undefined
            ? {}
            : { timeConfig: { p2pTime: options.p2pTime } })
    });
    if (options.cutPeer) {
        for (const index of [0, 1, 2])
            await h.rpcStub.suppressTimeoutCheck(index);
        for (const index of [0, 1])
            await h
                .control(h.getPeer(index))
                .stub.stubSuppressMaybePostBlockOnChain()
                .request();
    }
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
            waitForPeers: [0, 1, 2],
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
        payload: await servedPayload(h, responder, forkId)
    };
}

type ServedBlock = {
    hash: string;
    author: string;
    signers: string[];
    confirmation: ConfirmationStruct;
    snapshot: SnapshotStruct;
};

/** Peer 0's stored block at `height`: its confirmation, author and committed snapshot. */
export async function servedBlock(
    h: MathPeerTestHarness,
    forkId: string,
    height: number
): Promise<ServedBlock> {
    const query = h.control(h.getPeer(0)).query;
    const bundle = (await query.getBlockByHeight(forkId, height).request())!;
    const snapshot = (await query
        .getStateSnapshotStructByHash(bundle.stateSnapshotHash)
        .request())!;
    return {
        hash: bundle.hash,
        author: bundle.author,
        signers: [bundle.author, ...bundle.confirmationSignerAddresses].sort(),
        confirmation: Codec.decode(
            bundle.encodedBlockConfirmation,
            Type.BlockConfirmation
        ),
        snapshot: Codec.decode(snapshot.encodedSnapshot, Type.StateSnapshot)
    };
}

/** Peer 0's encoded state that `snapshot` commits. */
export async function servedState(
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
    confirmation: ConfirmationStruct,
    signers: string[]
): ConfirmationStruct {
    const block = Block.fromBlockConfirmation(confirmation);
    return {
        signedBlock: confirmation.signedBlock,
        signatures: confirmation.signatures.filter((signature) =>
            signers.includes(
                String(block.signatureToAddress(signature as string))
            )
        )
    };
}

/** A copy of `payload` serving `milestones`, their snapshots and `encodedState`. */
export function servingProof(
    payload: SyncPayload,
    milestones: ConfirmationStruct[][],
    milestoneSnapshots: SnapshotStruct[],
    encodedState: SyncPayload["latestFinalizedEncodedState"]
): SyncPayload {
    return {
        ...copyPayload(payload),
        stateProof: {
            milestones: milestones.map((blockConfirmations) => ({
                blockConfirmations
            }))
        },
        milestoneSnapshots,
        latestFinalizedEncodedState: encodedState
    };
}

/**
 * A copy of `payload` serving one milestone: peer 0's stored blocks from the
 * anchor block through `height` - 1, then an authentic block at `height` by
 * that height's author, linked to the stored block before it but committing
 * another snapshot. It conflicts with the stored block at `height`.
 */
export async function servingConflictAt(
    h: MathPeerTestHarness,
    payload: SyncPayload,
    anchor: StateSnapshot,
    height: number
): Promise<SyncPayload> {
    const forkId = String(anchor.forkID);
    const run: ServedBlock[] = [];
    for (let at = anchor.blockHeight; at < height; at++)
        run.push(await servedBlock(h, forkId, at));
    const stored = await servedBlock(h, forkId, height);
    const conflicting = await craftProofBlock(h, {
        authorIndex: h.peers.find((peer) => peer.address === stored.author)!
            .index,
        forkId,
        height,
        stateSnapshotHash: randomHash(),
        previousBlockHash: run.at(-1)!.hash
    });
    expect(conflicting.block.hash).to.not.equal(stored.hash);
    return servingProof(
        payload,
        [[...run.map((block) => block.confirmation), conflicting.confirmation]],
        [anchor.toStruct()],
        payload.latestFinalizedEncodedState
    );
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
    // Spectator setup happens between final blocks; allow it time before the next author.
    const staged = await stageAnchoredHistory(h, {
        blocksAfter: 4,
        p2pTime: 10
    });
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
 * {@link stageMergedSignaturePayload} whose second occurrence of a+2 is
 * another block at that height: authored by a+2's author, linked to a+1,
 * committing another state and confirmed by the real signature of a+1's
 * author. The second milestone's snapshot entry is that block's own
 * commitment, so only the block contents differ from the merged proof.
 */
export async function stageConflictingOverlapPayload(h: MathPeerTestHarness) {
    const staged = await stageMergedSignaturePayload(h);
    const { forkId, payload, first, support } = staged;
    const [original] = payload.milestoneSnapshots.slice(1);
    const other = StateSnapshot.from({
        ...original,
        snapshotData: {
            ...original.snapshotData,
            stateMachineStateHash: randomHash()
        }
    });
    const peerOf = (address: string) =>
        h.peers.find((peer) => peer.address === address)!;
    const conflicting = await craftProofBlock(h, {
        authorIndex: peerOf(
            String(
                Block.fromBlockConfirmation(
                    payload.stateProof.milestones[0].blockConfirmations[1]
                ).author
            )
        ).index,
        forkId,
        height: support.height,
        stateSnapshotHash: other.hash,
        previousBlockHash: first.block.hash
    });
    const confirmer = peerOf(
        String(
            Block.fromBlockConfirmation(
                payload.stateProof.milestones[0].blockConfirmations[0]
            ).author
        )
    );
    conflicting.confirmation.signatures = [
        await confirmer.signer.signMessage(getBytes(conflicting.block.hash))
    ];
    expect(conflicting.block.hash).to.not.equal(support.block.hash);
    payload.stateProof.milestones[1].blockConfirmations[0] =
        conflicting.confirmation;
    payload.milestoneSnapshots[1] = other.toStruct();
    return staged;
}

/**
 * `stageAnchoredHistory` with four final blocks a+1..a+4 above the anchor a,
 * an authentic block a+2′ by another author than a+2, linked to a+1 and
 * committing no real state, and an authentic a+3′ linked to a+2′. Returns
 * the served blocks and payloads built from them:
 * - `poisoned`: [a+1, a+2′] and [a+1] with a+1's state: a+2′ is support
 *   above the proven endpoint a+1;
 * - `honest`: [a+2, a+3] with a+2's state: a+3 is the replay tail;
 * - `forgedBeforeHop`: [a+1, a+2′] and [a+2, a+3] with a+2's state: two
 *   signed blocks at a+2, the real one a later hop;
 * - `forgedBranch`: [a+1, a+2′, a+3′] and [a+4] with a+4's state: a forged
 *   branch between two hops, the later hop's ancestry not in the proof;
 * - `overreach`: [a+1, a+2, a+3] and [a+1] with a+1's state: genuine
 *   support above the proven endpoint;
 * - `anchorOverreach`: [a, a+1, a+2] and [a] with the anchor's state:
 *   genuine support directly above the anchor block;
 * - `poisonedByAuthor`: as `poisoned`, its forged a+2″ authored by a+2's
 *   own author, and `honestTail`: [a+1, a+2, a+3] with a+1's state, whose
 *   tail replays the real a+2;
 * - `failingTail`: [a+2, a+3‴] with a+2's state, a+3‴ by a+3's author
 *   committing no real state: its replay fails;
 * - `authorOnlyTail`: [a+2, a+3] with a+2's state, a+3 carrying only its
 *   author's signature, and `supportOfStored`: [a+2, a+3 with one other
 *   confirmation] and [a+2] with a+2's state: a+3 is support that is
 *   already history after `authorOnlyTail`;
 * - `retainedVotes`: [a, a+1 author-only, a+2 with the third participant's
 *   confirmation] and [a] with the anchor's state: both blocks retained,
 *   and `thinTail`: [a, a+1 author-only, a+2 author-only] with the anchor's
 *   state, whose tail replays both into history without that confirmation;
 * - `forgedStartOnly`: [F′] with the anchor's state, F′ an authentic block at
 *   the anchor height committing the anchor snapshot but not the real anchor
 *   block; `forgedStartBelowHop`: [F′] and [a+1, a+2] with a+1's state;
 *   `forgedStartBesideReal`: [F′] and [a, a+1, a+2] with the anchor's state;
 * - `invalidAfterAnchor`: [a, a+1‴] with the anchor's state, a+1‴ by a+1's
 *   author linked to the anchor block, committing no real state;
 * - `tailSibling`: [a, a+1, a+2], [a, a+1″] and [a] with the anchor's state,
 *   a+1″ linked to a by another author than a+1, confirmed by every other
 *   participant and ground below a+1's hash.
 */
export async function stageForgedSupportPayloads(h: MathPeerTestHarness) {
    const staged = await stageAnchoredHistory(h, { blocksAfter: 4 });
    const { forkId, anchor, payload } = staged;
    const a = anchor.blockHeight;
    const [first, second, third, fourth] = [
        await servedBlock(h, forkId, a + 1),
        await servedBlock(h, forkId, a + 2),
        await servedBlock(h, forkId, a + 3),
        await servedBlock(h, forkId, a + 4)
    ];
    const forger = h.peers.find((peer) => peer.address !== second.author)!;
    const forgedSecond = await craftProofBlock(h, {
        authorIndex: forger.index,
        forkId,
        height: a + 2,
        stateSnapshotHash: randomHash(),
        previousBlockHash: first.hash
    });
    const forgedThird = await craftProofBlock(h, {
        authorIndex: forger.index,
        forkId,
        height: a + 3,
        stateSnapshotHash: randomHash(),
        previousBlockHash: String(forgedSecond.block.hash)
    });
    expect(forgedSecond.block.author).to.not.equal(second.author);
    const peerIndexOf = (address: string) =>
        h.peers.find((peer) => peer.address === address)!.index;
    const authorForgedSecond = await craftProofBlock(h, {
        authorIndex: peerIndexOf(second.author),
        forkId,
        height: a + 2,
        stateSnapshotHash: randomHash(),
        previousBlockHash: first.hash
    });
    const failingThird = await craftProofBlock(h, {
        authorIndex: peerIndexOf(third.author),
        forkId,
        height: a + 3,
        stateSnapshotHash: randomHash(),
        previousBlockHash: second.hash
    });
    const anchorBlock = await servedBlock(h, forkId, a);
    const thirdConfirmer = h.peers.find(
        (peer) =>
            peer.address !== third.author &&
            third.signers.includes(peer.address)
    )!;
    const voter = h.peers.find(
        (peer) =>
            peer.address !== first.author && peer.address !== second.author
    )!;
    const anchorState = await servedState(h, anchor.toStruct());
    const forgedStart = await craftProofBlock(h, {
        authorIndex: forger.index,
        forkId,
        height: a,
        stateSnapshotHash: anchor.hash,
        previousBlockHash: randomHash()
    });
    const invalidFirst = await craftProofBlock(h, {
        authorIndex: peerIndexOf(first.author),
        forkId,
        height: a + 1,
        stateSnapshotHash: randomHash(),
        previousBlockHash: anchorBlock.hash
    });
    const siblingAuthor = peerIndexOf(second.author);
    const craftSibling = () =>
        craftProofBlock(h, {
            authorIndex: siblingAuthor,
            forkId,
            height: a + 1,
            stateSnapshotHash: randomHash(),
            previousBlockHash: anchorBlock.hash
        });
    let sibling = await craftSibling();
    while (String(sibling.block.hash) > first.hash)
        sibling = await craftSibling();
    sibling.confirmation.signatures = await Promise.all(
        h.peers
            .filter((peer) => peer.index !== siblingAuthor)
            .map((peer) =>
                peer.signer.signMessage(getBytes(sibling.block.hash))
            )
    );
    const firstState = await servedState(h, first.snapshot);
    const secondState = await servedState(h, second.snapshot);
    return {
        ...staged,
        first,
        second,
        third,
        fourth,
        forgedSecond: forgedSecond.block,
        forgedThird: forgedThird.block,
        poisoned: servingProof(
            payload,
            [
                [first.confirmation, forgedSecond.confirmation],
                [first.confirmation]
            ],
            [first.snapshot, first.snapshot],
            firstState
        ),
        honest: servingProof(
            payload,
            [[second.confirmation, third.confirmation]],
            [second.snapshot],
            secondState
        ),
        forgedBeforeHop: servingProof(
            payload,
            [
                [first.confirmation, forgedSecond.confirmation],
                [second.confirmation, third.confirmation]
            ],
            [first.snapshot, second.snapshot],
            secondState
        ),
        forgedBranch: servingProof(
            payload,
            [
                [
                    first.confirmation,
                    forgedSecond.confirmation,
                    forgedThird.confirmation
                ],
                [fourth.confirmation]
            ],
            [first.snapshot, fourth.snapshot],
            await servedState(h, fourth.snapshot)
        ),
        overreach: servingProof(
            payload,
            [
                [first.confirmation, second.confirmation, third.confirmation],
                [first.confirmation]
            ],
            [first.snapshot, first.snapshot],
            firstState
        ),
        anchorOverreach: servingProof(
            payload,
            [
                [
                    anchorBlock.confirmation,
                    first.confirmation,
                    second.confirmation
                ],
                [anchorBlock.confirmation]
            ],
            [anchor.toStruct(), anchor.toStruct()],
            anchorState
        ),
        retainedVotes: servingProof(
            payload,
            [
                [
                    anchorBlock.confirmation,
                    keepSignatures(first.confirmation, []),
                    keepSignatures(second.confirmation, [voter.address])
                ],
                [anchorBlock.confirmation]
            ],
            [anchor.toStruct(), anchor.toStruct()],
            anchorState
        ),
        thinTail: servingProof(
            payload,
            [
                [
                    anchorBlock.confirmation,
                    keepSignatures(first.confirmation, []),
                    keepSignatures(second.confirmation, [])
                ]
            ],
            [anchor.toStruct()],
            anchorState
        ),
        forgedStart: forgedStart.block,
        forgedStartOnly: servingProof(
            payload,
            [[forgedStart.confirmation]],
            [anchor.toStruct()],
            anchorState
        ),
        forgedStartBelowHop: servingProof(
            payload,
            [
                [forgedStart.confirmation],
                [first.confirmation, second.confirmation]
            ],
            [anchor.toStruct(), first.snapshot],
            firstState
        ),
        forgedStartBesideReal: servingProof(
            payload,
            [
                [forgedStart.confirmation],
                [
                    anchorBlock.confirmation,
                    first.confirmation,
                    second.confirmation
                ]
            ],
            [anchor.toStruct(), anchor.toStruct()],
            anchorState
        ),
        anchorBlockHash: anchorBlock.hash,
        invalidAfterAnchor: servingProof(
            payload,
            [[anchorBlock.confirmation, invalidFirst.confirmation]],
            [anchor.toStruct()],
            anchorState
        ),
        tailSibling: servingProof(
            payload,
            [
                [
                    anchorBlock.confirmation,
                    first.confirmation,
                    second.confirmation
                ],
                [anchorBlock.confirmation, sibling.confirmation],
                [anchorBlock.confirmation]
            ],
            [anchor.toStruct(), anchor.toStruct(), anchor.toStruct()],
            anchorState
        ),
        authorForgedSecond: authorForgedSecond.block,
        poisonedByAuthor: servingProof(
            payload,
            [
                [first.confirmation, authorForgedSecond.confirmation],
                [first.confirmation]
            ],
            [first.snapshot, first.snapshot],
            firstState
        ),
        honestTail: servingProof(
            payload,
            [[first.confirmation, second.confirmation, third.confirmation]],
            [first.snapshot],
            firstState
        ),
        failingTail: servingProof(
            payload,
            [[second.confirmation, failingThird.confirmation]],
            [second.snapshot],
            secondState
        ),
        thirdConfirmer: thirdConfirmer.address,
        authorOnlyTail: servingProof(
            payload,
            [[second.confirmation, keepSignatures(third.confirmation, [])]],
            [second.snapshot],
            secondState
        ),
        supportOfStored: servingProof(
            payload,
            [
                [
                    second.confirmation,
                    keepSignatures(third.confirmation, [thirdConfirmer.address])
                ],
                [second.confirmation]
            ],
            [second.snapshot, second.snapshot],
            secondState
        )
    };
}

/**
 * `stageAnchoredHistory` with three final blocks above the anchor a, the
 * authors of a+1 and a+2 (A, B) and the third participant C. Payloads:
 * - `retainedSiblings`: [a, a+1 by A only, X], [a, a+1, Y] and [a] with the
 *   anchor's state: X is the real a+2 with C's confirmation, Y a forged a+2′
 *   by C confirmed by A and ground below X's hash. Y ranks with X ({A, C}
 *   against {B, C}) but its run cannot complete the hop of a+1;
 * - `outsiderSiblings`: [a, a+1, X], [a, a+1, Z, Z3] and [a]: Z a forged
 *   a+2″ by C confirmed by five outsiders, Z3 a forged a+3″ by B on Z, so
 *   Z's run completes the hop too, with fewer threshold signers on Z than X;
 * - `firstIntoHistory`: [a, a+1 by A only] with the anchor's state: its tail
 *   replays a+1 into history, the hop the retained siblings support.
 */
export async function stageRetainedSiblings(h: MathPeerTestHarness) {
    const staged = await stageAnchoredHistory(h, { blocksAfter: 3 });
    const { forkId, anchor, payload } = staged;
    const a = anchor.blockHeight;
    const anchorBlock = await servedBlock(h, forkId, a);
    const first = await servedBlock(h, forkId, a + 1);
    const second = await servedBlock(h, forkId, a + 2);
    const peerOf = (address: string) =>
        h.peers.find((peer) => peer.address === address)!;
    const third = h.peers.find(
        (peer) =>
            peer.address !== first.author && peer.address !== second.author
    )!;
    const firstAlone = keepSignatures(first.confirmation, []);
    const real = keepSignatures(second.confirmation, [third.address]);
    // a forged sibling that sorts before the real block on a tie
    let forged = await craftProofBlock(h, {
        authorIndex: third.index,
        forkId,
        height: a + 2,
        stateSnapshotHash: randomHash(),
        previousBlockHash: first.hash
    });
    while (String(forged.block.hash) > second.hash)
        forged = await craftProofBlock(h, {
            authorIndex: third.index,
            forkId,
            height: a + 2,
            stateSnapshotHash: randomHash(),
            previousBlockHash: first.hash
        });
    forged.confirmation.signatures = [
        await peerOf(first.author).signer.signMessage(
            getBytes(forged.block.hash)
        )
    ];
    const outsider = await craftProofBlock(h, {
        authorIndex: third.index,
        forkId,
        height: a + 2,
        stateSnapshotHash: randomHash(),
        previousBlockHash: first.hash
    });
    outsider.confirmation.signatures = await Promise.all(
        Array.from({ length: 5 }, () =>
            Wallet.createRandom().signMessage(getBytes(outsider.block.hash))
        )
    );
    const outsiderChild = await craftProofBlock(h, {
        authorIndex: peerOf(second.author).index,
        forkId,
        height: a + 3,
        stateSnapshotHash: randomHash(),
        previousBlockHash: String(outsider.block.hash)
    });
    const anchorState = await servedState(h, anchor.toStruct());
    const snapshots = [anchor.toStruct(), anchor.toStruct(), anchor.toStruct()];
    return {
        ...staged,
        first,
        second,
        forged: forged.block,
        outsider: outsider.block,
        retainedSiblings: servingProof(
            payload,
            [
                [anchorBlock.confirmation, firstAlone, real],
                [anchorBlock.confirmation, firstAlone, forged.confirmation],
                [anchorBlock.confirmation]
            ],
            snapshots,
            anchorState
        ),
        outsiderSiblings: servingProof(
            payload,
            [
                [anchorBlock.confirmation, firstAlone, real],
                [
                    anchorBlock.confirmation,
                    firstAlone,
                    outsider.confirmation,
                    outsiderChild.confirmation
                ],
                [anchorBlock.confirmation]
            ],
            snapshots,
            anchorState
        ),
        firstIntoHistory: servingProof(
            payload,
            [[anchorBlock.confirmation, firstAlone]],
            [anchor.toStruct()],
            anchorState
        )
    };
}

/**
 * One run of peer 0's stored blocks `from`..`to` served as the only
 * milestone, its supplied snapshot the one its first block commits, with
 * the state `stateSnapshot` commits: the payload a responder whose local
 * diamond still holds an older anchor serves.
 */
export async function servedRunPayload(
    h: MathPeerTestHarness,
    forkId: string,
    payload: SyncPayload,
    range: { from: number; to: number },
    stateSnapshot: SnapshotStruct
) {
    const run: ServedBlock[] = [];
    for (let height = range.from; height <= range.to; height++)
        run.push(await servedBlock(h, forkId, height));
    return {
        run,
        payload: servingProof(
            payload,
            [run.map((block) => block.confirmation)],
            [run[0].snapshot],
            await servedState(h, stateSnapshot)
        )
    };
}

/**
 * A well-formed block authored and signed by peer `authorIndex` at
 * `height`, linked to `previousBlockHash` (default: nothing), committing
 * `stateSnapshotHash`.
 */
export async function craftProofBlock(
    h: MathPeerTestHarness,
    options: {
        authorIndex: number;
        forkId: string;
        height: number;
        stateSnapshotHash: Hash;
        previousBlockHash?: string;
    }
): Promise<{ confirmation: ConfirmationStruct; block: Block }> {
    const encodedConfirmation = await buildAndEncodeBlock(
        h.getPeer(options.authorIndex).signer,
        {
            header: {
                channelId: h.channelId,
                forkId: options.forkId,
                transactionCnt: options.height
            },
            previousBlockHash: options.previousBlockHash ?? randomHash(),
            stateSnapshotHash: options.stateSnapshotHash
        }
    );
    const { signedBlock } = Codec.decode(
        encodedConfirmation,
        Type.BlockConfirmation
    );
    return {
        confirmation: { signedBlock, signatures: [] },
        block: Block.fromSignedBlock(signedBlock)
    };
}

/** A copy of `snapshot` moved to `height` without `dropped`: a participant-set change. */
export function snapshotWithout(
    snapshot: SnapshotStruct,
    height: number,
    dropped: Address
): StateSnapshot {
    const changed = StateSnapshot.from({
        ...snapshot,
        blockHeight: height,
        snapshotData: {
            ...snapshot.snapshotData,
            participants: snapshot.snapshotData.participants.filter(
                (participant) => participant !== dropped
            )
        }
    });
    expect(changed.snapshotData.participants.length).to.equal(
        snapshot.snapshotData.participants.length - 1
    );
    return changed;
}

/**
 * The requester's local diamond misses the InboundMessagesProcessed log of
 * peer 0's top-up while its storage and ingest keep up; then two final
 * blocks of peers 0..2 consume the top-up. Every threshold hop over that
 * inbound run is then unprovable on the requester's local diamond, while
 * the chain holds the run.
 */
async function missConsumedTopUp(
    h: MathPeerTestHarness,
    requester: Peer
): Promise<void> {
    const held = await h.mirror.holdUpdates(
        requester.index,
        "onInboundMessagesProcessed"
    );
    await h.join.forceInboundJoinWait({
        participant: h.getPeer(0).address,
        observePeerIndices: [0, 1, 2]
    });
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    expect(
        await held.heldCount(),
        "the requester's mirror must have missed the top-up"
    ).to.be.greaterThan(0);
}

/**
 * An early requester (see {@link withEarlyHeldRequester}) whose block queue
 * is held: after three blocks peers 0..2 author two more final blocks, and
 * the gossiped first one waits in its queue. The requester then
 * applies peer 0's served compact proof, which installs the head above that
 * block without storing it. The queue is released only after the install;
 * then one more live block follows. Returns the apply outcome, the queued
 * block and what the requester holds after each step.
 */
export async function syncAboveHeldQueuedBlock(h: MathPeerTestHarness) {
    return await withEarlyHeldRequester(
        h,
        { blockCount: 3, gossip: "holdQueue" },
        async (requester, forkId) => {
            const participantQuery = h.control(h.getPeer(0)).query;
            const control = h.control(requester);
            const query = control.query;
            const queuedHeight = await participantQuery
                .getNextBlockHeight(forkId)
                .request();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const queuedHash = await participantQuery
                .getBlockHashAt(forkId, queuedHeight)
                .request();
            expect(queuedHash, "the authored block").to.not.equal(null);
            await waitFor(
                async () => await query.isBlockQueued(queuedHash!).request(),
                h.event.protocolEventTimeoutMs()
            );
            const applied = await applyPayloads(h, requester, forkId, [
                "served"
            ]);
            const installed = {
                queuedBlockStored:
                    (await query
                        .getBlockHashAt(forkId, queuedHeight)
                        .request()) !== null,
                stillQueued: await query.isBlockQueued(queuedHash!).request()
            };
            await control.stub.releaseBlockWorkHold().request();
            await waitFor(
                async () => !(await query.isBlockQueued(queuedHash!).request()),
                h.event.protocolEventTimeoutMs()
            );
            const afterDrop = {
                queuedBlockStored:
                    (await query
                        .getBlockHashAt(forkId, queuedHeight)
                        .request()) !== null,
                blacklisted: await Promise.all(
                    [0, 1, 2].map((index) =>
                        query.isBlacklisted(h.getPeer(index).address).request()
                    )
                ),
                closed: runtimeIsClosed(requester.p2pInstance)
            };
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const liveHash = await participantQuery
                .getLatestBlockHash(forkId)
                .request();
            await waitFor(
                async () =>
                    (await query.getLatestBlockHash(forkId).request()) ===
                    liveHash,
                h.event.protocolEventTimeoutMs()
            );
            return {
                applied,
                queuedHeight,
                installed,
                afterDrop,
                followed: {
                    blacklisted: await Promise.all(
                        [0, 1, 2].map((index) =>
                            query
                                .isBlacklisted(h.getPeer(index).address)
                                .request()
                        )
                    ),
                    closed: runtimeIsClosed(requester.p2pInstance)
                }
            };
        }
    );
}

/**
 * Four participants and two blocks; the next writer leaves in a final block
 * (the change height) and the others author two more final blocks. Every
 * peer's snapshot post is held at its send, so the leaver's exit stays
 * unposted and the change stays above the genesis anchor. `release` lets the
 * held sends go; call it before the test ends.
 */
export async function stageHeldUnpostedLeave(h: MathPeerTestHarness) {
    await h.lifecycle.start(4, 2);
    const forkId = String(h.activeForkId!);
    for (const index of [0, 1, 2, 3])
        await h
            .control(h.getPeer(index))
            .stub.stubHoldSnapshotPostSend()
            .request();
    const release = async () => {
        for (const index of [0, 1, 2, 3])
            await h
                .control(h.getPeer(index))
                .stub.restoreSnapshotPostSend()
                .request();
    };
    const before = (await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const leaverIndex = await h.transition.participantLeaveStateTransition();
    const remaining = [0, 1, 2, 3].filter((index) => index !== leaverIndex);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: remaining,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: remaining });
    return { forkId, changeHeight: before + 1, remaining, release };
}

/** Hold the canonical verifier before execution, preserving its real answer and chain state selection. */
export async function holdCanonicalProofWalk(
    h: MathPeerTestHarness,
    peer: Peer
) {
    await h.execOnHost(peer, (sm) => {
        const contract = sm.stateChannelManagerContract;
        const method = contract.getFunction("verifyMilestones");
        const original = method.staticCall;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        Reflect.set(contract, "proofReadEntered", false);
        Reflect.set(contract, "releaseProofRead", release);
        const held = async (...args: Parameters<typeof original>) => {
            Reflect.set(contract, "proofReadEntered", true);
            await gate;
            return original(...args);
        };
        const replacement = Object.defineProperties(
            (...args: Parameters<typeof method>) => method(...args),
            {
                ...Object.getOwnPropertyDescriptors(method),
                staticCall: { value: held, configurable: true }
            }
        );
        Object.defineProperty(contract, "verifyMilestones", {
            value: replacement,
            configurable: true
        });
        return true;
    });
    return {
        entered: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    Reflect.get(
                        sm.stateChannelManagerContract,
                        "proofReadEntered"
                    ) === true
            ),
        release: () =>
            h.execOnHost(peer, (sm) => {
                const contract = sm.stateChannelManagerContract;
                Reflect.get(contract, "releaseProofRead")?.();
                Reflect.deleteProperty(contract, "verifyMilestones");
                Reflect.deleteProperty(contract, "proofReadEntered");
                Reflect.deleteProperty(contract, "releaseProofRead");
                return true;
            })
    };
}
