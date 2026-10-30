// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import type { Address } from "@/types/types";
import { addressesEqual } from "@/utils";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { MirrorUpdateHold } from "@test/harness/actions/MirrorActions";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";

type MathPeer = TestPeer<
    P2pRuntimeHostRoot<HarnessControlRpc>,
    MathStateMachine
>;

/**
 * Three participants and a joiner whose JOIN is pending on chain. Peer 0 has
 * applied the JOIN event to its storage and its local diamond. `beforeJoin`
 * runs once the channel is open, before the JOIN is submitted. Returns the
 * joiner.
 */
export async function stageMirroredPendingJoin(
    h: MathPeerTestHarness,
    initialTransitions = 0,
    beforeJoin?: (joiner: MathPeer) => Promise<unknown>
) {
    const prepared =
        await h.scenario.syncSpectatorAndPrepareJoin(initialTransitions);
    await beforeJoin?.(h.getPeer(prepared.joiner.index));
    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
        prepared.confirmation,
        prepared.expectedSnapshotHash,
        prepared.expectedForkId
    );
    await h.assert.storage.honestPeersObserveInboundMessageWait();
    // the event handler marks the joiner eligible after its local diamond
    // applied the JOIN
    await waitFor(
        async () =>
            (await h
                .control(h.getPeer(0))
                .query.getSourceEligibility(prepared.joiner.address)
                .request()) === SourceEligibility.ELIGIBLE
    );
    return prepared.joiner;
}

/**
 * Peer 0 forgets every cached eligibility and refreshes it from the chain.
 * Returns the refresh result, each source's eligibility after it, and
 * whether the local diamond's inbound head equals the chain's.
 */
export async function refreshAfterEligibilityReset(
    h: MathPeerTestHarness,
    sources: string[]
) {
    return h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            sm.membershipService.resetEligibility();
            const refreshed =
                await sm.membershipService.refreshOnChainEligibility();
            const [mirrored, chain] = await Promise.all([
                sm.diamondStateMachine.localDiamondContract.getChannelBalance(
                    sm.channelId
                ),
                sm.stateChannelManagerContract.getChannelBalance(sm.channelId)
            ]);
            return {
                refreshed,
                eligibility: args.sources.map((source) =>
                    sm.membershipService.getCachedSourceEligibility(source)
                ),
                isMirrorAtChainInboundHead:
                    String(mirrored.latestInboundMessageBlockHash) ===
                    String(chain.latestInboundMessageBlockHash)
            };
        },
        { sources }
    );
}

/**
 * Peer 0 forgets every cached eligibility; then peer 1, a snapshot
 * participant, relays peer 0's latest block to it over the real
 * state-transition RPC. Peer 1 refuses any spectate sync request, so only
 * the chain refresh can admit it. Waits until peer 0 resolved peer 1 as
 * eligible and returns how many sync requests peer 1 received.
 */
export async function relayAfterEligibilityReset(h: MathPeerTestHarness) {
    const receiver = h.getPeer(0);
    const sender = h.getPeer(1);
    const block = await h
        .control(receiver)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!block) throw new Error("Expected a stored block");
    const senderStub = h.control(sender).stub;
    await senderStub.holdSpectateResponses(true).request();
    try {
        await h.execOnHost(receiver, (sm) =>
            sm.membershipService.resetEligibility()
        );
        await h
            .control(sender)
            .byzantine.sendBlockConfirmation(
                block.encodedBlockConfirmation,
                receiver.address
            )
            .request();
        await waitFor(
            async () =>
                (await h
                    .control(receiver)
                    .query.getSourceEligibility(sender.address)
                    .request()) === SourceEligibility.ELIGIBLE,
            h.event.protocolEventTimeoutMs()
        );
        return await senderStub.getHeldSpectateResponseCount().request();
    } finally {
        await senderStub.releaseSpectateResponses().request();
    }
}

/**
 * Peer 0's local diamond against the chain: whether its inbound head and
 * deposit total equal the chain's, whether it holds each of `blockHashes`,
 * and whether its snapshot is the chain's.
 */
async function readPeerZeroMirror(
    h: MathPeerTestHarness,
    blockHashes: string[]
) {
    const mirrored = await h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            const local = sm.diamondStateMachine.localDiamondContract;
            const [balance, chainBalance] = await Promise.all([
                local.getChannelBalance(sm.channelId),
                sm.stateChannelManagerContract.getChannelBalance(sm.channelId)
            ]);
            return {
                isHeadAtChain:
                    String(balance.latestInboundMessageBlockHash) ===
                        String(chainBalance.latestInboundMessageBlockHash) &&
                    Number(balance.latestInboundMessageBlockHeight) ===
                        Number(chainBalance.latestInboundMessageBlockHeight),
                isTotalDepositsAtChain:
                    String(balance.totalDeposits.amount) ===
                    String(chainBalance.totalDeposits.amount),
                heldBlocks: await Promise.all(
                    args.blockHashes.map((blockHash) =>
                        local.hasInboundMessageBlock(sm.channelId, blockHash)
                    )
                )
            };
        },
        { blockHashes }
    );
    const snapshotHash = (await h.query.getLocalStateSnapshot(h.getPeer(0)))
        .hash;
    return {
        ...mirrored,
        isSnapshotAtChain:
            snapshotHash === (await h.query.getOnChainSnapshotHash())
    };
}

/** Peer 0 forgets every cached eligibility and refreshes it from the chain. */
function refreshPeerZero(h: MathPeerTestHarness) {
    return h.execOnHost(h.getPeer(0), async (sm) => {
        sm.membershipService.resetEligibility();
        return sm.membershipService.refreshOnChainEligibility();
    });
}

/** The newest inbound block in peer 0's storage. */
async function latestInboundHash(h: MathPeerTestHarness): Promise<string> {
    const latest = await h
        .control(h.getPeer(0))
        .query.getLatestInboundMessageHash()
        .request();
    if (!latest) throw new Error("Expected a stored inbound block");
    return latest;
}

/**
 * Peer 0's local diamond holds its inbound applications while a joiner's
 * JOIN lands (the live log's application) and peer 0 refreshes from the
 * chain (the refresh's application of the same block). The held
 * applications then run in `order`: "recorded" applies the live one first,
 * "reverse" the refresh's first. Returns the refresh result, the held
 * count and peer 0's mirror against the chain.
 */
export async function applyJoinBlockFromLiveAndRefresh(
    h: MathPeerTestHarness,
    order: "recorded" | "reverse"
) {
    let held: MirrorUpdateHold | undefined;
    await stageMirroredPendingJoin(h, 0, async () => {
        held = await h.mirror.holdUpdates(0, "onInboundMessagesProcessed");
    });
    if (!held) throw new Error("Expected the mirror hold");
    const joinBlockHash = await latestInboundHash(h);
    const refreshed = await refreshPeerZero(h);
    const heldCount = await held.heldCount();
    await held.release(order);
    return {
        refreshed,
        heldCount,
        mirror: await readPeerZeroMirror(h, [joinBlockHash])
    };
}

/**
 * Two top-ups by peer 1. Peer 0's local diamond misses the first one's log
 * for good and applies the second, so it lacks a block below its head.
 * Then peer 0 refreshes from the chain. Returns the mirror before and after
 * the refresh for [first, second] and the refresh result.
 */
export async function refreshFillsMirrorBelowHead(h: MathPeerTestHarness) {
    const topUp = { participant: h.getPeer(1).address };
    const held = await h.mirror.holdUpdates(0, "onInboundMessagesProcessed");
    await h.join.forceInboundJoinWait(topUp);
    const missed = await latestInboundHash(h);
    await waitFor(async () => (await held.heldCount()) === 1);
    await held.discard();
    await h.join.forceInboundJoinWait(topUp);
    const head = await latestInboundHash(h);
    await waitFor(
        async () => (await readPeerZeroMirror(h, [head])).heldBlocks[0]
    );
    const before = await readPeerZeroMirror(h, [missed, head]);
    const refreshed = await refreshPeerZero(h);
    return {
        before,
        refreshed,
        after: await readPeerZeroMirror(h, [missed, head])
    };
}

/**
 * Peer 0's refresh reads the chain, then waits while peer 0 posts a newer
 * snapshot and its local diamond applies the live StateSnapshotUpdated
 * log. Then the refresh applies its older read. Returns the refresh result
 * and peer 0's mirror against the chain.
 */
export async function refreshAppliedAfterLiveSnapshot(h: MathPeerTestHarness) {
    const peer = h.getPeer(0);
    const stub = h.control(peer).stub;
    await stub.recordPublishedSnapshots().request();
    await stub.observeAdmission({ holdMembership: true }).request();
    const pending = refreshPeerZero(h);
    try {
        await waitFor(
            async () =>
                (await stub.getAdmissionObservation().request()).chainReads ===
                1
        );
        // the barrier waits until every honest local diamond has the snapshot
        const posted = await h.transition.postSnapshotWait();
        if (!posted) throw new Error("Expected a posted snapshot");
        await stub.releaseAdmissionMembership().request();
        const refreshed = await pending;
        const published = await stub.getLastPublishedSnapshotHash().request();
        return {
            refreshed,
            mirror: await readPeerZeroMirror(h, []),
            membership: {
                isMirroredSnapshotPublished:
                    published ===
                    (await h.query.getLocalStateSnapshot(peer)).hash
            }
        };
    } finally {
        await stub.releaseAdmissionMembership().request();
        await pending.catch(() => undefined);
        await stub.restoreAdmissionObservation().request();
        await stub.restorePublishedSnapshots().request();
    }
}

/** The joiner's local diamond lists the joiner's own pending JOIN. */
async function isOwnJoinMirrored(h: MathPeerTestHarness, joiner: MathPeer) {
    return h.execOnHost(joiner, async (sm) =>
        sm.membershipService.includesSigner(
            await sm.diamondStateMachine.localDiamondContract.getPendingParticipants(
                sm.channelId
            )
        )
    );
}

/**
 * A pending JOIN (see {@link stageMirroredPendingJoin}) that the joiner's own
 * local diamond applied too. Returns the joiner.
 */
export async function stagePendingJoinMirroredByJoiner(h: MathPeerTestHarness) {
    const joiner = h.getPeer((await stageMirroredPendingJoin(h)).index);
    await waitFor(() => isOwnJoinMirrored(h, joiner));
    return joiner;
}

/**
 * A pending JOIN (see {@link stageMirroredPendingJoin}) whose log the
 * joiner's own local diamond misses for good. Returns the joiner and
 * whether its local diamond lists the JOIN.
 */
export async function stagePendingJoinMissedByJoinerMirror(
    h: MathPeerTestHarness
) {
    let held: MirrorUpdateHold | undefined;
    const staged = await stageMirroredPendingJoin(h, 0, async (joiner) => {
        held = await h.mirror.holdUpdates(
            joiner.index,
            "onInboundMessagesProcessed"
        );
    });
    if (!held) throw new Error("Expected the mirror hold");
    const hold = held;
    await waitFor(async () => (await hold.heldCount()) === 1);
    await hold.discard();
    const joiner = h.getPeer(staged.index);
    return { joiner, isOwnJoinMirrored: await isOwnJoinMirrored(h, joiner) };
}

/**
 * The peer's own membership lookups (`MembershipService`) next to the chain's
 * answer: whether the chain's seated and pending sets list the peer.
 */
export async function readSignerMembershipLookups(
    h: MathPeerTestHarness,
    peer: MathPeer
) {
    const [seated, pending] = await Promise.all([
        h.channelManager.getParticipants(h.channelId),
        h.channelManager.getPendingParticipants(h.channelId)
    ]);
    const isListed = (participants: readonly string[]) =>
        participants.some((participant) =>
            addressesEqual(participant as Address, peer.address as Address)
        );
    const lookups = await h.execOnHost(peer, async (sm) => {
        const membership = sm.membershipService;
        return {
            isInLocalState: await membership.isSignerInLocalState(),
            isPendingInMirror: await membership.isSignerPendingInMirror(),
            isPendingOnChain: await membership.isSignerPendingOnChain(),
            isOnChain: await membership.isSignerOnChain()
        };
    });
    return {
        isSeatedOnChain: isListed(seated),
        isListedPendingOnChain: isListed(pending),
        ...lookups
    };
}

/**
 * The pending `joiner` runs `read` against the chain while its chain calls
 * are recorded: "refresh" refreshes its eligibility from the chain,
 * "onChainSnapshot" applies the chain's current snapshot through the
 * spectate service (no pinned read). Returns the joiner's status, the
 * result and the recorded calls.
 */
export async function recordPendingJoinerChainCalls(
    h: MathPeerTestHarness,
    joiner: MathPeer,
    read: "refresh" | "onChainSnapshot"
) {
    const recorded = await h.rpcStub.recordChainCalls(joiner.index);
    try {
        const outcome = await h.execOnHost(
            joiner,
            async (sm, args) => {
                const status = sm.status;
                if (args.read === "refresh")
                    return {
                        status,
                        result: await sm.membershipService.refreshOnChainEligibility()
                    };
                await sm.p2pManager.localRpc.spectateService.fetchAndPersistOnChainSnapshot(
                    sm.channelId
                );
                return { status, result: true };
            },
            { read }
        );
        return { ...outcome, calls: await recorded.calls() };
    } finally {
        await recorded.restore();
    }
}

/**
 * Peer `peerIndex` refreshes its eligibility from the chain. Returns the
 * refresh result, or the message of the failure it rejected with.
 */
export async function refreshOutcome(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<{ refreshed: boolean | null; error: string | null }> {
    return h.execOnHost(h.getPeer(peerIndex), async (sm) => {
        try {
            return {
                refreshed:
                    await sm.membershipService.refreshOnChainEligibility(),
                error: null
            };
        } catch (error) {
            return {
                refreshed: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
}

/**
 * Peer 0 misses the InboundMessagesProcessed log of peer 1's top-up, so
 * its refresh recovers that log from the chain, while the local diamond's
 * next inbound application fails. Returns the refresh outcome.
 */
export async function refreshWithFailedRecoveredInboundBlock(
    h: MathPeerTestHarness
) {
    const dropped = await h.rpcStub.dropInboundMessageLogs(0);
    try {
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(1).address,
            observePeerIndices: [1]
        });
        await dropped.waitUntilDropped();
        await h.mirror.failNextUpdate(0, "onInboundMessagesProcessed");
        return await refreshOutcome(h, 0);
    } finally {
        await dropped.release();
    }
}
