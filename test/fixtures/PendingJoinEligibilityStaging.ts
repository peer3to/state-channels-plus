// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import type { Address } from "@/types/types";
import { addressesEqual } from "@/utils";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";

type MathPeer = TestPeer<
    P2pRuntimeHostRoot<HarnessControlRpc>,
    MathStateMachine
>;

/**
 * Three participants and a joiner whose JOIN is pending on chain. Peer 0 has
 * applied the JOIN event to its storage. `beforeJoin`
 * runs once the channel is open, before the JOIN is submitted. With
 * `isJoinerUnobserved` the wait for the inbound message skips the joiner
 * (its handler is held). Returns the joiner.
 */
export async function stageObservedPendingJoin(
    h: MathPeerTestHarness,
    initialTransitions = 0,
    beforeJoin?: (joiner: MathPeer) => Promise<unknown>,
    isJoinerUnobserved = false
) {
    const prepared =
        await h.scenario.syncSpectatorAndPrepareJoin(initialTransitions);
    await beforeJoin?.(h.getPeer(prepared.joiner.index));
    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
        prepared.confirmation,
        prepared.expectedSnapshotHash,
        prepared.expectedForkId
    );
    await h.assert.storage.honestPeersObserveInboundMessageWait(
        isJoinerUnobserved
            ? {
                  peerIndices: h.peers
                      .map((peer) => peer.index)
                      .filter((index) => index !== prepared.joiner.index)
              }
            : undefined
    );
    // the event handler marks the joiner eligible once it handled the JOIN
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

/** Peer 0 forgets every cached eligibility and refreshes it from the chain. */
function refreshPeerZero(h: MathPeerTestHarness) {
    return h.execOnHost(h.getPeer(0), async (sm) => {
        sm.membershipService.resetEligibility();
        return sm.membershipService.refreshOnChainEligibility();
    });
}

/**
 * Peer 0's refresh reads the chain, then waits while peer 0 posts a newer
 * snapshot and handles the live StateSnapshotUpdated log. Then the refresh
 * applies its older read. Returns the refresh result and whether membership
 * published the chain's snapshot.
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
        // the barrier waits until every honest peer has handled the snapshot
        const posted = await h.transition.postSnapshotWait();
        if (!posted) throw new Error("Expected a posted snapshot");
        await stub.releaseAdmissionMembership().request();
        const refreshed = await pending;
        const published = await stub.getLastPublishedSnapshotHash().request();
        return {
            refreshed,
            membership: {
                isMirroredSnapshotPublished:
                    published === (await h.query.getOnChainSnapshotHash())
            }
        };
    } finally {
        await stub.releaseAdmissionMembership().request();
        await pending.catch(() => undefined);
        await stub.restoreAdmissionObservation().request();
        await stub.restorePublishedSnapshots().request();
    }
}

/**
 * Whether the joiner's pending lookup (pinned at the block of the last
 * InboundMessagesProcessed it handled) lists the joiner's own pending JOIN.
 */
async function isOwnJoinObserved(h: MathPeerTestHarness, joiner: MathPeer) {
    return h.execOnHost(joiner, (sm) =>
        sm.membershipService.isSignerPendingAtLastPendingSetChange()
    );
}

/**
 * A pending JOIN (see {@link stageObservedPendingJoin}) that the joiner's own
 * event handler handled too. Returns the joiner.
 */
export async function stagePendingJoinHandledByJoiner(h: MathPeerTestHarness) {
    const joiner = h.getPeer((await stageObservedPendingJoin(h)).index);
    await waitFor(() => isOwnJoinObserved(h, joiner));
    return joiner;
}

/**
 * A pending JOIN (see {@link stageObservedPendingJoin}) whose
 * InboundMessagesProcessed log never reaches the joiner's event pipeline
 * (the chain lists the JOIN, the joiner has not seen its block). Returns the
 * joiner and whether its pending lookup lists the JOIN.
 */
export async function stagePendingJoinMissedByJoinerHandler(
    h: MathPeerTestHarness
) {
    let dropped:
        | Awaited<ReturnType<typeof h.rpcStub.dropInboundMessageLogs>>
        | undefined;
    const staged = await stageObservedPendingJoin(
        h,
        0,
        async (joiner) => {
            dropped = await h.rpcStub.dropInboundMessageLogs(joiner.index);
        },
        true
    );
    if (!dropped) throw new Error("Expected the inbound log drop");
    await dropped.waitUntilDropped();
    const joiner = h.getPeer(staged.index);
    return { joiner, isOwnJoinObserved: await isOwnJoinObserved(h, joiner) };
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
            isPendingAtLastInbound:
                await membership.isSignerPendingAtLastPendingSetChange(),
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
 * its refresh recovers that log from the chain, while the handler of the
 * next inbound log fails. Returns the refresh outcome.
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
        const failing = await h.rpcStub.failInboundMessagesProcessedHandler(0);
        try {
            return await refreshOutcome(h, 0);
        } finally {
            await failing.restore();
        }
    } finally {
        await dropped.release();
    }
}
