// @spec-test-coverage-ignore: shared reduction-attempt staging exercised by the mapped ReductionExecutor test declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { StateSnapshot } from "@/models";
import type { ForkId } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";
import { ZeroHash } from "ethers";

/**
 * Waits out the fork's kill period on the peer, then runs one executor
 * attempt there and reports whether it threw and the fork it left.
 */
export async function tryReduceAfterKillPeriod(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
) {
    // let the kill period lapse - before that the attempt returns at
    // the gate and never reaches the reduce computation
    await waitFor(
        async () =>
            h.execOnHost(
                h.getPeer(peerIndex),
                async (sm, a) => {
                    const { isExpired } =
                        await sm.reductionManager.isKillPeriodExpiredCached(
                            a.forkId
                        );
                    return isExpired;
                },
                { forkId }
            ),
        h.event.protocolEventTimeoutMs()
    );

    // drive the executor directly: ReductionManager.tryReduce returns
    // the shared completion promise, which a deferred attempt leaves
    // pending on purpose
    return await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            let threw = "";
            try {
                await sm.reductionManager["reductionExecutor"].tryReduce(
                    args.forkId
                );
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }
            return { threw, forkIdAfter: String(sm.forkId) };
        },
        { forkId },
        {
            timeoutMs: h.event.hostExecTimeoutMs()
        }
    );
}

/**
 * A spectator behind a disputed window's reduced head
 * (`stageSpectatedDisputeAboveSpectatorHead`), once the survivors' reduction
 * is recorded on chain. The survivors' timeout checks are suppressed so the
 * idle successor opens no second dispute, the offender's reduce is held so a
 * survivor is the recorded reducer, every reduction entry point of the
 * spectator is held (`holdReductionRace`), its scheduled tasks are recorded
 * and its syncs are counted, so only a hand-driven attempt acts.
 */
export async function stageBehindSpectatorAfterChainReduction(
    h: MathPeerTestHarness,
    options?: { participantCount?: number; spectators?: number }
) {
    const staged =
        await h.scenario.stageSpectatedDisputeAboveSpectatorHead(options);
    const { forkId, spectatorIndex, spectatorIndices, survivors } = staged;
    for (const index of survivors) await h.rpcStub.suppressTimeoutCheck(index);
    // the slashed offender's reduce stays held, so the recorded reducer is a
    // survivor
    const offenderHolds = await Promise.all(
        h.peers
            .filter(
                (peer) =>
                    !spectatorIndices.includes(peer.index) &&
                    !survivors.includes(peer.index)
            )
            .map((peer) => h.rpcStub.holdReductionAttempt(peer.index, "submit"))
    );
    // every reduction entry point on the spectator is held, so no attempt but
    // the hand-driven one runs; its reschedules are recorded and held
    const race = await h.rpcStub.holdReductionRace(spectatorIndex);
    const scheduled = await h.rpcStub.recordScheduledTasks(spectatorIndex);
    await h.rpcStub.recordSpectateSync(spectatorIndex, { forward: true });
    await waitFor(
        async () => (await h.query.reducedForkOnChain(forkId)) !== ZeroHash,
        h.event.protocolEventTimeoutMs() * 2
    );
    const { reducedForkId, reducer } = await h.channelManager.getReducedResult(
        h.channelId,
        forkId
    );
    // ends every hold this staging placed
    const release = async () => {
        await race.release();
        await Promise.all(offenderHolds.map((hold) => hold.release()));
    };
    return {
        ...staged,
        release,
        scheduled,
        reducedForkId: reducedForkId as ForkId,
        reducer: String(reducer)
    };
}

/**
 * After `stageBehindSpectatorAfterChainReduction`: the survivors install the
 * recorded successor, author on it, and dispute it; waits until the chain
 * records that second reduction and its snapshot is adopted on the newest
 * fork, so the chain snapshot has moved past the first successor. Returns
 * the newest fork and the survivors still participating on it.
 */
export async function reduceSuccessorOnChain(
    h: MathPeerTestHarness,
    staged: {
        forkId: ForkId;
        survivors: number[];
        reducedForkId: ForkId;
    }
) {
    const { forkId, survivors, reducedForkId } = staged;
    await h.assert.sync.forkChangedWait({
        originalForkId: forkId,
        honestPeerIndices: survivors
    });
    await h.transition.advanceState({ count: 1, waitForPeers: survivors });
    const offenderIndex = (await h.query.getNextPeerToWrite()).index;
    const remaining = survivors.filter((index) => index !== offenderIndex);
    await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex, {
        forkId: reducedForkId
    });
    await waitFor(
        async () =>
            (await h.query.reducedForkOnChain(reducedForkId)) !== ZeroHash,
        h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }) * 2
    );
    const newestForkId = (await h.query.reducedForkOnChain(
        reducedForkId
    )) as ForkId;
    await waitFor(
        async () =>
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).forkID === newestForkId,
        h.event.protocolEventTimeoutMs() * 2
    );
    return { newestForkId, remaining };
}
