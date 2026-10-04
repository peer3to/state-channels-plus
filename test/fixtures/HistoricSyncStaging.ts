// @spec-test-coverage-ignore: anchored and forged sync staging exercised by explicit SpectateService declarations
import { clientRootFor } from "./RuntimeRootObservation";
import { Block, StateSnapshot } from "@/models";
import { Status, type SyncPayload } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { getBytes, id } from "ethers";

/**
 * Chain snapshot strictly between the fork genesis and the proven target on
 * the same fork; returns peer 0's payload for the target and the anchor.
 */
export async function stageAnchoredSyncPayload(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    const forkId = h.activeForkId!;
    const responder = h.getPeer(0);
    const requester = h.getPeer(2);
    expect(
        await h.transition.postSnapshotWait({
            peerIndex: responder.index,
            forkId: String(forkId)
        })
    ).to.not.equal(undefined);
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    const latestHeight = await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request();
    const onChainSnapshot = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChainSnapshot.forkID).to.equal(forkId);
    expect(onChainSnapshot.blockHeight).to.be.greaterThan(0);
    expect(onChainSnapshot.blockHeight).to.be.lessThan(latestHeight!);

    const served = await h
        .control(responder)
        .spectate.generateSyncPayload(h.channelId, forkId, latestHeight!)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    expect(served).to.not.equal(null);
    const payload = Codec.decode(served!.encodedSyncPayload, Type.SyncPayload);
    return {
        forkId,
        responder,
        requester,
        latestHeight: latestHeight!,
        onChainSnapshot,
        payload
    };
}

/**
 * The staged payload is altered by `mutate` and participant 2 applies it,
 * pinned to its height. Returns the verdict and the rejection reasons.
 */
export async function applyAnchoredSyncPayload(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload, onChainSnapshot: StateSnapshot) => void
): Promise<{ accepted: boolean; rejections: string[] }> {
    const staged = await stageAnchoredSyncPayload(h);
    mutate(staged.payload, staged.onChainSnapshot);
    const { verdicts, rejections } = await applyCasesAsParticipant(
        h,
        staged.requester.index,
        staged.responder.index,
        [
            {
                encodedSyncPayload: Codec.encode(
                    staged.payload,
                    Type.SyncPayload
                ) as string,
                forkId: String(staged.forkId),
                blockHeight: staged.latestHeight
            }
        ]
    );
    return { accepted: verdicts[0] === true, rejections };
}

/** A forged outbound block that does not link to the on-chain outbound head. */
export function forgedOutboundBlock(
    payload: SyncPayload
): SyncPayload["outboundMessageBlocksOfTheLatestFork"][number] {
    const latest =
        payload.milestoneSnapshots.at(-1) ?? payload.latestForkGenesisSnapshot;
    return {
        previousBlockHash: id("not the on-chain outbound head"),
        blockHeight:
            BigInt(latest.snapshotData.latestOutboundMessageBlockHeight) + 1n,
        messages: [],
        totalBalance: latest.snapshotData.totalWithdrawals,
        timestamp: 1n
    };
}

/**
 * Prepend a one-block milestone at `height`: a copy of the proof's first block
 * moved there (its signatures no longer match), with a copy of the first
 * milestone snapshot. Returns the planted block and snapshot.
 */
export function prependMilestoneAt(payload: SyncPayload, height: number) {
    const first = payload.stateProof.milestones[0].blockConfirmations[0];
    const block = Codec.decode(first.signedBlock.encodedBlock, Type.Block);
    block.transaction.header.transactionCnt = BigInt(height);
    const planted = {
        signedBlock: {
            encodedBlock: Codec.encode(block, Type.Block) as string,
            signature: first.signedBlock.signature
        },
        signatures: first.signatures
    };
    payload.stateProof.milestones.unshift({ blockConfirmations: [planted] });
    const plantedSnapshot = {
        ...payload.milestoneSnapshots[0],
        timestamp: BigInt(payload.milestoneSnapshots[0].timestamp) + 1n
    };
    payload.milestoneSnapshots.unshift(plantedSnapshot);
    return { planted, plantedSnapshot };
}

/**
 * A fresh spectator whose own initial sync is held at its application (no
 * local history or final point) runs `run`; the hold is released after it.
 */
export async function withHeldFreshRequester<T>(
    h: MathPeerTestHarness,
    run: (requester: ReturnType<MathPeerTestHarness["getPeer"]>) => Promise<T>
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
        await stub.restoreHoldSpectateSyncApplication().request();
    }
}

export type FreshApplyOptions = {
    /** Its local diamond's `verifyMilestones` read fails at the executor connection. */
    faultLocalWalk?: boolean;
    /** Its chain anchor read (`getStateSnapshot`) is refused, as a failed RPC would. */
    faultChainAnchor?: boolean;
    /** A latest request (no fork) instead of one pinned to `forkId`. */
    latest?: boolean;
    /** Runs once the requester is held, before the first payload is applied. */
    beforeApply?: () => Promise<void>;
    snapshotHash?: string;
};

/**
 * A held fresh requester applies each encoded payload from peer 0 in order
 * through the real `applySyncResponse`, in one host call. Returns per payload
 * the verdict (or the message of a thrown apply), the head after it and
 * whether `snapshotHash` is stored; then the rejection reasons, the
 * requester's on-chain transaction count before and after, and the responder
 * blacklist.
 */
export async function applyInOrderOnFreshRequester(
    h: MathPeerTestHarness,
    forkId: string,
    encodedPayloads: string[],
    options: FreshApplyOptions = {}
) {
    const responder = h.getPeer(0);
    return await withHeldFreshRequester(h, async (requester) => {
        const stub = h.control(requester).stub;
        await stub.recordSyncRejections().request();
        const walks = options.faultLocalWalk
            ? await h.mirror.observe(requester.index, "verifyMilestones")
            : undefined;
        try {
            await options.beforeApply?.();
            if (walks)
                await h.mirror.failNextLocalRead(
                    requester.index,
                    "verifyMilestones",
                    "transport"
                );
            const noncesBefore = await h.provider.getTransactionCount(
                requester.address
            );
            const outcomes = await h.execOnHost(
                requester,
                async (sm, a) => {
                    if (a.faultChainAnchor) {
                        // the next anchor read meets a refused RPC
                        const contract = sm.stateChannelManagerContract;
                        const provider = contract.runner!.provider!;
                        const selector =
                            contract.interface.getFunction(
                                "getStateSnapshot"
                            )!.selector;
                        const call = provider.call.bind(provider);
                        provider.call = async (transaction) => {
                            if (!String(transaction.data).startsWith(selector))
                                return call(transaction);
                            provider.call = call;
                            throw new Error("chain anchor read refused");
                        };
                    }
                    const service = sm.p2pManager.localRpc.spectateService;
                    const results: {
                        accepted: boolean;
                        threw: string;
                        latestHeight: number;
                        storedSnapshot: boolean;
                    }[] = [];
                    for (const encodedSyncPayload of a.encodedPayloads) {
                        let accepted = false;
                        let threw = "";
                        try {
                            // the prototype method: the held initial sync stays held
                            accepted = await Object.getPrototypeOf(
                                service
                            ).applySyncResponse.call(
                                service,
                                a.responder,
                                {
                                    channelId: sm.channelId,
                                    forkId: a.forkId ?? undefined
                                },
                                encodedSyncPayload
                            );
                        } catch (error) {
                            threw = String(error);
                        }
                        results.push({
                            accepted,
                            threw,
                            latestHeight:
                                sm.storage.blocks.getNextBlockHeight(
                                    a.headForkId
                                ) - 1,
                            storedSnapshot:
                                !!a.snapshotHash &&
                                !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                                    a.snapshotHash
                                )
                        });
                    }
                    return results;
                },
                {
                    responder: responder.address,
                    forkId: options.latest ? null : forkId,
                    headForkId: forkId,
                    encodedPayloads,
                    faultChainAnchor: !!options.faultChainAnchor,
                    snapshotHash: options.snapshotHash ?? null
                },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            return {
                outcomes,
                rejections: await stub
                    .restoreRecordedSyncRejections()
                    .request(),
                noncesBefore,
                noncesAfter: await h.provider.getTransactionCount(
                    requester.address
                ),
                blacklisted: await h
                    .control(requester)
                    .query.isBlacklisted(responder.address)
                    .request()
            };
        } finally {
            await walks?.restore();
            await stub.restoreRecordedSyncRejections().request();
        }
    });
}

/** {@link applyInOrderOnFreshRequester} for one payload. */
export async function applyOnFreshRequester(
    h: MathPeerTestHarness,
    forkId: string,
    payload: SyncPayload,
    options: FreshApplyOptions = {}
) {
    const { outcomes, rejections, blacklisted } =
        await applyInOrderOnFreshRequester(
            h,
            forkId,
            [Codec.encode(payload, Type.SyncPayload) as string],
            options
        );
    return { ...outcomes[0], rejections, blacklisted };
}

/** A recovery request a participant applies a payload against. */
export type ParticipantSyncCase = {
    encodedSyncPayload: string;
    forkId: string;
    blockHeight: number | null;
    /** Its chain anchor read (`getStateSnapshot`) is refused, as a failed RPC would. */
    faultChainAnchor?: boolean;
};

/**
 * Participant `requester` applies each case from `responder` through the
 * real `applySyncResponse`, in order, in one host call. Returns each verdict
 * (or the message of a thrown apply) and the rejection reasons, with its head
 * and status before and after.
 */
export async function applyCasesAsParticipant(
    h: MathPeerTestHarness,
    requesterIndex: number,
    responderIndex: number,
    cases: ParticipantSyncCase[]
) {
    const requester = h.getPeer(requesterIndex);
    const responder = h.getPeer(responderIndex);
    const forkId = h.activeForkId!;
    const query = h.control(requester).query;
    const headBefore = await query.getLatestBlockHeight(forkId).request();
    const stub = h.control(requester).stub;
    await stub.recordSyncRejections().request();
    try {
        const verdicts = await h.execOnHost(
            requester,
            async (sm, a) => {
                const results: (boolean | string)[] = [];
                for (const c of a.cases) {
                    if (c.faultChainAnchor) {
                        // the next anchor read meets a refused RPC
                        const contract = sm.stateChannelManagerContract;
                        const provider = contract.runner!.provider!;
                        const selector =
                            contract.interface.getFunction(
                                "getStateSnapshot"
                            )!.selector;
                        const call = provider.call.bind(provider);
                        provider.call = async (transaction) => {
                            if (!String(transaction.data).startsWith(selector))
                                return call(transaction);
                            provider.call = call;
                            throw new Error("chain anchor read refused");
                        };
                    }
                    try {
                        results.push(
                            await sm.p2pManager.localRpc.spectateService.applySyncResponse(
                                a.responder,
                                {
                                    channelId: sm.channelId,
                                    forkId: c.forkId,
                                    blockHeight: c.blockHeight ?? undefined
                                },
                                c.encodedSyncPayload
                            )
                        );
                    } catch (error) {
                        results.push(String(error));
                    }
                }
                return results;
            },
            { responder: responder.address, cases },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        return {
            verdicts,
            rejections: await stub.restoreRecordedSyncRejections().request(),
            headBefore,
            headAfter: await query.getLatestBlockHeight(forkId).request(),
            status: await query.getStatus().request(),
            blacklisted: await query.isBlacklisted(responder.address).request()
        };
    } finally {
        await stub.restoreRecordedSyncRejections().request();
    }
}

/** A channel whose only block is block 0, final; peer 0's payload for it. */
export async function stageBlockZeroPayload(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    await h.transition.advanceState({ count: 1, waitForFinalization: true });
    const forkId = String(h.activeForkId!);
    const served = await h
        .control(h.getPeer(0))
        .spectate.generateSyncPayload(h.channelId, forkId, 0)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    const payload = Codec.decode(served!.encodedSyncPayload, Type.SyncPayload);
    // the proof is the one block-0 milestone
    expect(
        payload.stateProof.milestones.map((m) => m.blockConfirmations.length)
    ).to.deep.equal([1]);
    return { forkId, payload };
}

/** One forged element of an honest payload, named by the step it fails. */
export type SyncForgery =
    | "lineage"
    | "genesis"
    | "preGenesisOutbound"
    | "finality"
    | "finalizedState"
    | "proofBlock";

const FORGERIES: Record<
    SyncForgery,
    (payload: SyncPayload, onChainSnapshot: StateSnapshot) => void
> = {
    // a dispute window on the on-chain fork, which was never disputed
    lineage: (payload, onChainSnapshot) => {
        payload.disputeWindows.push({
            disputeConfirmations: [],
            forkId: String(onChainSnapshot.forkID),
            latestStateSnapshot: payload.latestForkGenesisSnapshot,
            latestEncodedStateMachineState:
                payload.latestForkGenesisEncodedState,
            inboundMessageBlocksAppliedInReduce: [],
            reducedForkId: id("forged reduced fork")
        });
    },
    genesis: (payload) => {
        payload.latestForkGenesisSnapshot.snapshotData.stateMachineStateHash =
            id("forged genesis state");
    },
    preGenesisOutbound: (payload) => {
        payload.outboundMessageBlocksUpToLatestGenesis.push(
            forgedOutboundBlock(payload)
        );
    },
    finality: (payload) => {
        const last = payload.milestoneSnapshots.at(-1)!;
        last.timestamp = BigInt(last.timestamp) + 1n;
    },
    finalizedState: (payload) => {
        payload.latestFinalizedEncodedState = id("forged finalized state");
    },
    proofBlock: (payload) => {
        payload.stateProof.milestones[0].blockConfirmations[0].signedBlock.encodedBlock =
            "0xdeadbeef";
    }
};

/** The honest `payload` with each named element forged, encoded per forgery. */
export function forgeSyncPayloads<T extends SyncForgery>(
    payload: SyncPayload,
    onChainSnapshot: StateSnapshot,
    forgeries: readonly T[]
): Record<T, string> {
    const encodedHonest = Codec.encode(payload, Type.SyncPayload) as string;
    const encoded = {} as Record<T, string>;
    for (const forgery of forgeries) {
        const copy = Codec.decode(encodedHonest, Type.SyncPayload);
        FORGERIES[forgery](copy, onChainSnapshot);
        encoded[forgery] = Codec.encode(copy, Type.SyncPayload) as string;
    }
    return encoded;
}

/**
 * Move the served genesis timestamp one second; its data, fork id and height
 * stay genesis-shaped. Returns the hash of the altered genesis.
 */
export function forgeGenesisTimestamp(payload: SyncPayload): string {
    const genesis = payload.latestForkGenesisSnapshot;
    genesis.timestamp = BigInt(genesis.timestamp) + 1n;
    return String(StateSnapshot.from(genesis).hash);
}

/**
 * Colluding participants: block 0 of a block-zero payload now commits to a
 * snapshot claiming one deposit unit more than the chain holds, and every
 * genesis participant signs it with its real key. The proof stays walk-valid
 * and final; its state breaks the balance invariant. Returns the hash of the
 * forged snapshot.
 */
export async function forgeUnbackedDepositBlockZero(
    h: MathPeerTestHarness,
    payload: SyncPayload
): Promise<string> {
    const milestone = payload.stateProof.milestones[0];
    const snapshot = payload.milestoneSnapshots[0];
    const deposits = snapshot.snapshotData.totalDeposits;
    snapshot.snapshotData.totalDeposits = {
        ...deposits,
        amount: BigInt(deposits.amount) + 1n
    };
    const forgedHash = String(StateSnapshot.from(snapshot).hash);
    const blockStruct = {
        ...Codec.decode(
            milestone.blockConfirmations[0].signedBlock.encodedBlock,
            Type.Block
        ),
        stateSnapshotHash: forgedHash
    };
    const signerOf = (address: string) =>
        h.peers.find((peer) => peer.address === address)!.signer;
    const author = String(blockStruct.transaction.header.participant);
    const block = await Block.fromBlockStruct(blockStruct, signerOf(author));
    block.expandSignatures(
        await Promise.all(
            payload.latestForkGenesisSnapshot.snapshotData.participants
                .map(String)
                .filter((address) => address !== author)
                .map((address) => block.sign(signerOf(address)))
        )
    );
    milestone.blockConfirmations[0] = block.blockConfirmationStruct;
    return forgedHash;
}

/**
 * A spectator whose initial sync request is held at both participants before
 * the payload is built, while five final blocks are authored and queued on
 * the spectator, so the served proof starts above the first queued block. Returns the spectator and the first queued block's
 * height and hash, checked to be queued before the release and not covered
 * by the installed history after it.
 */
export async function syncSpectatorAboveQueuedBlocks(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 2);
    const participants = [0, 1];
    const stubs = participants.map((index) => h.control(h.getPeer(index)).stub);
    for (const stub of stubs)
        await stub.holdSpectateResponses(false, true).request();
    try {
        const spectator = await h.join.addSpectatorDetached();
        await waitFor(
            async () =>
                (
                    await Promise.all(
                        stubs.map((stub) =>
                            stub.getHeldSpectateResponseCount().request()
                        )
                    )
                ).some((count) => count > 0),
            h.event.protocolEventTimeoutMs()
        );
        const forkId = h.activeForkId!;
        const participantQuery = h.control(h.getPeer(0)).query;
        const queuedHeight = await participantQuery
            .getNextBlockHeight(forkId)
            .request();
        await h.transition.advanceState({
            count: 5,
            waitForPeers: participants,
            waitForFinalization: true
        });
        const queuedHash = await participantQuery
            .getBlockHashAt(forkId, queuedHeight)
            .request();
        if (!queuedHash) throw new Error("Expected the authored block");
        const spectatorQuery = h.control(spectator).query;
        await waitFor(
            async () =>
                await spectatorQuery.isBlockQueued(queuedHash).request(),
            h.event.protocolEventTimeoutMs()
        );
        for (const stub of stubs)
            await stub.releaseSpectateResponses().request();
        await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
        expect(
            await spectatorQuery.getBlockHashAt(forkId, queuedHeight).request()
        ).to.equal(null);
        expect(
            await spectatorQuery.getNextBlockHeight(forkId).request()
        ).to.be.greaterThan(queuedHeight);
        return { spectator, forkId, queuedHeight, queuedHash };
    } finally {
        for (const stub of stubs)
            await stub.releaseSpectateResponses().request();
    }
}

/**
 * Three participants; peer 2 is cut off, so the blocks peers 0 and 1 author
 * after it stay below the signature threshold and peer 0's payload ends in an
 * unfinal tail. Returns that payload and a copy whose last tail block is
 * re-signed by its author over its predecessor's state hash (an invalid
 * transition the walk cannot see). Timeout checks are suppressed: peer 2's
 * idle writer slot would open a participant-timeout dispute.
 */
export async function stageForgedUnfinalTailPayload(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3, { timeConfig: { chainFallbackTime: 60 } });
    for (const index of [0, 1]) await h.rpcStub.suppressTimeoutCheck(index);
    await h.network.blacklistAndDisconnectPeer(2);
    await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
    const forkId = String(h.activeForkId!);
    const responder = h.getPeer(0);
    const latestHeight = await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request();
    const served = await h
        .control(responder)
        .spectate.generateSyncPayload(h.channelId, forkId, latestHeight!)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    const encoded = served!.encodedSyncPayload;
    const payload = Codec.decode(encoded, Type.SyncPayload);
    const forged = Codec.decode(encoded, Type.SyncPayload);
    const run = forged.stateProof.milestones.at(-1)!.blockConfirmations;
    expect(run.length, "an unfinal tail").to.be.greaterThan(1);
    const tailEnd = Block.fromBlockConfirmation(run.at(-1)!);
    const struct = Codec.decode(tailEnd.encode(), Type.Block);
    struct.stateSnapshotHash = Block.fromBlockConfirmation(
        run.at(-2)!
    ).stateSnapshotHash;
    const authorIndex = [0, 1].find(
        (index) => h.getPeer(index).address === tailEnd.author
    )!;
    const resigned = await Block.fromBlockStruct(
        struct,
        h.getPeer(authorIndex).signer
    );
    run[run.length - 1] = { signedBlock: resigned.signedBlock, signatures: [] };
    return { forkId, responder, payload, forged };
}

/**
 * The cut-off participant (peer 2) applies `payloads` in order from peer 0
 * through the real `applySyncResponse`; `failReplayOf` arms an executor fault
 * on the tail replay of that payload. Returns per payload the verdict or the
 * thrown message, then the rejections, the responder blacklist and whether
 * the chain records a dispute on the fork.
 */
export async function applyOnCutParticipant(
    h: MathPeerTestHarness,
    staged: { forkId: string; responder: { address: string } },
    payloads: SyncPayload[],
    failReplayOf?: number
) {
    const participant = h.getPeer(2);
    const control = h.control(participant);
    await control.stub.recordSyncRejections().request();
    try {
        const outcomes: { accepted: boolean; threw: string }[] = [];
        for (const [index, payload] of payloads.entries()) {
            if (index === failReplayOf)
                await control.stub.failNextBlockReplay().request();
            outcomes.push(
                await h.execOnHost(
                    participant,
                    async (sm, args) => {
                        try {
                            return {
                                accepted:
                                    await sm.p2pManager.localRpc.spectateService.applySyncResponse(
                                        args.responder,
                                        {
                                            channelId: sm.channelId,
                                            forkId: args.forkId
                                        },
                                        args.encodedSyncPayload
                                    ),
                                threw: ""
                            };
                        } catch (error) {
                            return { accepted: false, threw: String(error) };
                        }
                    },
                    {
                        responder: staged.responder.address,
                        forkId: staged.forkId,
                        encodedSyncPayload: Codec.encode(
                            payload,
                            Type.SyncPayload
                        ) as string
                    },
                    { timeoutMs: h.event.hostExecTimeoutMs() }
                )
            );
        }
        return {
            outcomes,
            rejections: await control.stub
                .restoreRecordedSyncRejections()
                .request(),
            blacklisted: await control.query
                .isBlacklisted(staged.responder.address)
                .request()
        };
    } finally {
        await control.stub.restoreRecordedSyncRejections().request();
    }
}

/**
 * Every participant serves `payload` (peer 2 included, so no responder
 * serves an honest one) and a fresh spectator runs its real initial load.
 * Returns whether its runtime closed.
 */
export async function freshSpectatorStopsOnPayload(
    h: MathPeerTestHarness,
    payload: SyncPayload
): Promise<boolean> {
    const encoded = Codec.encode(payload, Type.SyncPayload) as string;
    const stubs = [0, 1, 2].map((index) => h.control(h.getPeer(index)).stub);
    try {
        for (const stub of stubs)
            await stub.stubSpectatePayload(encoded).request();
        const spectator = await h.join.createSpectatorPeer();
        const host = clientRootFor(
            spectator.p2pInstance
        ).p2pRuntimeHostRemoteRoot!;
        await spectator.p2pInstance.p2pSigner.connectToChannel(h.channelId);
        await waitFor(() => host.isClosed, h.event.protocolEventTimeoutMs());
        return host.isClosed;
    } finally {
        for (const stub of stubs)
            await stub.restoreSpectateStaleProof().request();
    }
}

/**
 * `stageForgedUnfinalTailPayload`, then the participant keys turn peer 0's
 * last run [k, k+1, ...] (k is peer 2's head, the blocks above it unfinal)
 * into two threshold-final milestones: [k'], an alternative block k with a
 * later timestamp (same state hash) signed by all three keys, and the real
 * [k+1, ...] with peer 2's confirmation added to k+1. The served state is the
 * state of k+1, above peer 2's head, so persistence reaches k'.
 */
export async function stageConflictingFinalRunPayload(h: MathPeerTestHarness) {
    const staged = await stageForgedUnfinalTailPayload(h);
    const payload = Codec.decode(
        Codec.encode(staged.payload, Type.SyncPayload),
        Type.SyncPayload
    );
    const run = payload.stateProof.milestones.at(-1)!.blockConfirmations;
    expect(run.length, "an unfinal tail").to.be.greaterThan(1);
    const signerOf = (address: string) =>
        [0, 1, 2]
            .map((index) => h.getPeer(index))
            .find((peer) => peer.address === address)!.signer;
    const signers = [0, 1, 2].map((index) => h.getPeer(index).signer);

    const real = Block.fromBlockConfirmation(run[0]);
    const struct = Codec.decode(real.encode(), Type.Block);
    struct.transaction.header.timestamp =
        BigInt(struct.transaction.header.timestamp) + 1n;
    const author = signerOf(String(real.author));
    const alternative = await Block.fromBlockStruct(struct, author);
    const alternativeConfirmation = {
        signedBlock: alternative.signedBlock,
        signatures: await Promise.all(
            signers
                .filter((signer) => signer !== author)
                .map((signer) => signer.signMessage(getBytes(alternative.hash)))
        )
    };
    const next = Block.fromBlockConfirmation(run[1]);
    run[1] = {
        ...run[1],
        signatures: [
            ...run[1].signatures,
            await h.getPeer(2).signer.signMessage(getBytes(next.hash))
        ]
    };
    const query = h.control(staged.responder).query;
    const stored = await query
        .getStateSnapshotStructByHash(next.stateSnapshotHash)
        .request();
    const nextSnapshot = Codec.decode(
        stored!.encodedSnapshot,
        Type.StateSnapshot
    );
    payload.stateProof.milestones.splice(
        -1,
        1,
        {
            blockConfirmations: [alternativeConfirmation]
        },
        { blockConfirmations: run.slice(1) }
    );
    payload.milestoneSnapshots.push(nextSnapshot);
    payload.latestFinalizedEncodedState = (await query
        .getStateMachineState(
            StateSnapshot.from(nextSnapshot).stateMachineStateHash
        )
        .request())!;
    return { ...staged, conflict: payload, conflictHeight: real.height };
}

/**
 * `stageForgedUnfinalTailPayload`, then the participant keys turn peer 0's
 * last run [k, k+1, ...] into two threshold-final milestones: the real [k],
 * and [k+1'], block k+1 re-signed by all three keys over a copy of its
 * snapshot without peer 2 (a participant-set change; same state). A held
 * fresh spectator applies it from peer 0. Returns the verdict, the
 * rejections, the heights of k and k+1', whether each milestone snapshot is
 * stored and the stored participant-set change heights.
 */
export async function syncAcrossForgedParticipantChange(
    h: MathPeerTestHarness
) {
    const staged = await stageForgedUnfinalTailPayload(h);
    const payload = Codec.decode(
        Codec.encode(staged.payload, Type.SyncPayload),
        Type.SyncPayload
    );
    const run = payload.stateProof.milestones.at(-1)!.blockConfirmations;
    const query = h.control(staged.responder).query;
    const next = Block.fromBlockConfirmation(run[1]);
    const stored = await query
        .getStateSnapshotStructByHash(next.stateSnapshotHash)
        .request();
    const real = StateSnapshot.from(
        Codec.decode(stored!.encodedSnapshot, Type.StateSnapshot)
    );
    const leaver = h.getPeer(2).address;
    const changed = StateSnapshot.from({
        ...real.toStruct(),
        snapshotData: {
            ...real.toStruct().snapshotData,
            participants: real.snapshotData.participants.filter(
                (participant) => String(participant) !== leaver
            )
        }
    });
    expect(changed.snapshotData.participants).to.have.length(2);
    const struct = Codec.decode(next.encode(), Type.Block);
    struct.stateSnapshotHash = changed.hash;
    const signers = [0, 1, 2].map((index) => h.getPeer(index).signer);
    const author = signers.find(
        (_, index) => h.getPeer(index).address === String(next.author)
    )!;
    const resigned = await Block.fromBlockStruct(struct, author);
    payload.stateProof.milestones.splice(
        -1,
        1,
        { blockConfirmations: [run[0]] },
        {
            blockConfirmations: [
                {
                    signedBlock: resigned.signedBlock,
                    signatures: await Promise.all(
                        signers
                            .filter((signer) => signer !== author)
                            .map((signer) =>
                                signer.signMessage(getBytes(resigned.hash))
                            )
                    )
                }
            ]
        }
    );
    const firstSnapshot = StateSnapshot.from(
        payload.milestoneSnapshots.at(-1)!
    );
    payload.milestoneSnapshots.push(changed.toStruct());
    payload.latestFinalizedEncodedState = (await query
        .getStateMachineState(real.stateMachineStateHash)
        .request())!;
    const encodedSyncPayload = Codec.encode(
        payload,
        Type.SyncPayload
    ) as string;
    const forkId = staged.forkId;
    return await withHeldFreshRequester(h, async (requester) => {
        const stub = h.control(requester).stub;
        await stub.recordSyncRejections().request();
        // live gossip of the real block k+1 conflicts with k+1' and aborts
        // the requester before its storage is read
        const restoreConfirmations = await h.rpcStub.dropNetworkConfirmations(
            requester.index
        );
        try {
            const accepted = await h.execOnHost(
                requester,
                async (sm, a) => {
                    const service = sm.p2pManager.localRpc.spectateService;
                    // the prototype method: the held initial sync stays held
                    return await Object.getPrototypeOf(
                        service
                    ).applySyncResponse.call(
                        service,
                        a.responder,
                        { channelId: sm.channelId, forkId: a.forkId },
                        a.encodedSyncPayload
                    );
                },
                {
                    responder: staged.responder.address,
                    forkId,
                    encodedSyncPayload
                },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            const requesterQuery = h.control(requester).query;
            const isStored = async (snapshot: StateSnapshot) =>
                (await requesterQuery
                    .getStateSnapshotStructByHash(snapshot.hash)
                    .request()) !== null;
            return {
                accepted,
                rejections: await stub
                    .restoreRecordedSyncRejections()
                    .request(),
                firstHeight: Block.fromBlockConfirmation(run[0]).height,
                changeHeight: next.height,
                firstStored: await isStored(firstSnapshot),
                changedStored: await isStored(changed),
                changeHeights: await requesterQuery
                    .getParticipantChangeHeights(forkId)
                    .request()
            };
        } finally {
            await restoreConfirmations();
            await stub.restoreRecordedSyncRejections().request();
        }
    });
}
