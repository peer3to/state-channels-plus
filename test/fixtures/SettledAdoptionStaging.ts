// @spec-test-coverage-ignore: staging for a reducer's held fork adoption that the chain refuses as settled
import type { ForkId } from "@/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

const REDUCER_INDEX = 0;
const SETTLEMENT_MARGIN_SECONDS = 2;

export type SettledAdoptionRefusal =
    | "RaceConditionSnapshotUpdateNotLatestFork"
    | "RaceConditionSnapshotUpdateDisputedFork";

/** The reducer's adopt-only post, prepared against the successor and parked at its send. */
export type HeldSuccessorAdoption = {
    sourceForkId: ForkId;
    successorForkId: ForkId;
    /** Send the parked post for real; its revert name, or null when it was mined. */
    release: () => Promise<string | null>;
    /** Adopt-only posts the reducer sent (a multicall whose only call is `updateStateSnapshotFork`). */
    adoptionPosts: () => Promise<number>;
    /** `adoptReducedFork-*` retries the reducer scheduled. */
    adoptionRetries: () => Promise<number>;
};

/**
 * A reducible disputed fork that only the reducer reduces. Its reduce lands,
 * and its follow-up adopt-only post is prepared against the then latest,
 * undisputed successor fork and parked at its send. Every peer's timeout check
 * is suppressed so the idle successor gets no unrelated timeout dispute, and
 * the reducer's reduction timers are held again so it never reduces the
 * successor itself.
 */
export async function stageHeldSuccessorAdoption(
    h: MathPeerTestHarness
): Promise<HeldSuccessorAdoption> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    await Promise.all(
        h.peers.map((peer) => h.rpcStub.suppressTimeoutCheck(peer.index))
    );
    const reducer = h.getPeer(REDUCER_INDEX);
    // Fails no post; it records every multicall the reducer sends. Installed
    // before the hold, so the parked post is recorded when it is released.
    const sends = await h.rpcStub.failFirstAdoptionPost(reducer.index, 0);
    const adoption = await h.rpcStub.holdSnapshotPostSend(reducer.index, {
        adoptionOnly: true
    });
    await h.control(reducer).stub.restoreReductionTasks(true).request();
    await adoption.waitUntilHeld();
    await h.control(reducer).stub.stubHoldReductionTasks().request();
    // after the reduction-task restore, which resets scheduleTask
    const tasks = await h.rpcStub.recordScheduledTasks(reducer.index);
    const successorForkId = await h.query.reducedForkOnChain(sourceForkId);
    expect(successorForkId, "the reduce landed").to.not.equal(ZeroHash);
    return {
        sourceForkId,
        successorForkId,
        release: adoption.release,
        adoptionPosts: async () =>
            (await sends.recorded()).filter(
                (names) =>
                    names.length === 1 && names[0] === "updateStateSnapshotFork"
            ).length,
        adoptionRetries: async () =>
            (await tasks.tasks()).filter((task) =>
                task.taskName.startsWith("adoptReducedFork-")
            ).length
    };
}

/**
 * Open a dispute window on the successor while the adoption is parked: a
 * successor participant other than the reducer and the next writer
 * broadcasts an invalid block, and the honest participants dispute it.
 * Returns an honest successor participant other than the reducer.
 */
export async function openSuccessorDispute(
    h: MathPeerTestHarness,
    held: HeldSuccessorAdoption
): Promise<{ honestIndex: number }> {
    const reducer = h.getPeer(REDUCER_INDEX);
    const participants = await h
        .control(reducer)
        .query.getParticipants()
        .request();
    const members = h.peers.filter((peer) =>
        participants.includes(peer.address)
    );
    await waitFor(async () => {
        for (const peer of members)
            if (
                (await h.control(peer).query.getForkId().request()) !==
                held.successorForkId
            )
                return false;
        return true;
    }, h.event.protocolEventTimeoutMs());
    const nextWriter = await h
        .control(reducer)
        .query.getNextToWrite()
        .request();
    const others = members.filter((peer) => peer.index !== REDUCER_INDEX);
    const malicious = others.find((peer) => peer.address !== nextWriter)!;
    const honest = others.find((peer) => peer.index !== malicious.index)!;
    await h.byzantine.submitInvalidStateTransitionBlock(malicious.index, {
        forkId: held.successorForkId
    });
    await waitFor(
        async () =>
            (await h.query.killPeriod(held.successorForkId, REDUCER_INDEX))
                .windowExists,
        h.event.protocolEventTimeoutMs()
    );
    return { honestIndex: honest.index };
}

/** The later reduction of the successor, final, with its reducer's own adoption parked. */
export type FinalLaterReduction = {
    laterForkId: ForkId;
    /** Send the later reducer's parked adoption; its revert name, or null when it was mined. */
    releaseLaterAdoption: () => Promise<string | null>;
};

/**
 * Let an honest successor participant other than the reducer reduce the
 * successor's window, and wait until that later reduction is final (its
 * reduce challenge period expired). That reducer's own adopt-only post is
 * parked at its send, so the chain snapshot stays on the source fork: the
 * chain walks from it through the successor to the later fork, and the
 * successor is reachable but not latest.
 */
export async function finalizeLaterReduction(
    h: MathPeerTestHarness,
    held: HeldSuccessorAdoption,
    reducerIndex: number
): Promise<FinalLaterReduction> {
    const laterAdoption = await h.rpcStub.holdSnapshotPostSend(reducerIndex, {
        adoptionOnly: true
    });
    await h
        .control(h.getPeer(reducerIndex))
        .stub.restoreReductionTasks(true)
        .request();
    const windowCreatedAt = Number(
        await h.channelManager.getDisputeWindowCreationTimestamp(
            h.channelId,
            held.successorForkId
        )
    );
    await h.event.waitUntilTimestamp(
        windowCreatedAt +
            h.event.evidencePeriodWaitMs(SETTLEMENT_MARGIN_SECONDS) / 1000
    );
    const { killPeriodEnd } = await h.channelManager.isKillPeriodExpired(
        h.channelId,
        held.successorForkId
    );
    await h.event.waitUntilTimestamp(
        Number(killPeriodEnd) + SETTLEMENT_MARGIN_SECONDS
    );
    let laterForkId = ZeroHash as ForkId;
    await waitFor(async () => {
        laterForkId = await h.query.reducedForkOnChain(held.successorForkId);
        return laterForkId !== ZeroHash;
    }, h.event.protocolEventTimeoutMs());
    // the later reducer prepared its adoption against the landed reduce
    await laterAdoption.waitUntilHeld();
    await waitFor(
        async () =>
            await h.channelManager.isReduceChallengePeriodExpired(
                h.channelId,
                held.successorForkId
            ),
        h.event.protocolEventTimeoutMs()
    );
    return { laterForkId, releaseLaterAdoption: laterAdoption.release };
}

/**
 * Release the parked adoption: the chain refuses it with `refusal` and the
 * chain snapshot stays on the source fork. With `later`, the later reducer's
 * parked adoption is then sent and the chain adopts the later fork. The
 * executor settles the refusal: no detached failure, no retry, no further
 * adoption post.
 */
export async function assertSettledAdoptionRefusal(
    h: MathPeerTestHarness,
    held: HeldSuccessorAdoption,
    refusal: SettledAdoptionRefusal,
    later?: FinalLaterReduction
): Promise<void> {
    const chainForkId = async () =>
        (await h.channelManager.getStateSnapshot(h.channelId)).forkId;
    expect(await held.release()).to.equal(refusal);
    expect(await chainForkId()).to.equal(held.sourceForkId);
    if (later) {
        expect(await later.releaseLaterAdoption()).to.equal(null);
        expect(await chainForkId()).to.equal(later.laterForkId);
    }
    await TestSession.settleDetached();
    expect(await held.adoptionRetries(), "no adoption retry").to.equal(0);
    expect(
        await held.adoptionPosts(),
        "the refused post is the only adoption sent"
    ).to.equal(1);
}
