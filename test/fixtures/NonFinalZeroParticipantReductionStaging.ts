// @spec-test-coverage-ignore: shared staging for two leavers whose self-removal disputes form a non-final reduction that leaves no participant
import type { ForkId } from "@/types";
import {
    recordLeaveChannelLogs,
    recordSnapshotPostWaitResults
} from "@test/fixtures/BotConnectionFixesStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

const REDUCER_INDEX = 0;
const LEAVER_INDEX = 1;
const SETTLEMENT_MARGIN_SECONDS = 2;
/** The leave service's log line for an expected chain refusal of an exit post. */
const EXIT_POST_REFUSED = "The chain refused the exit snapshot post";
/** The error of an adopt-only post failed by `failFirstAdoptionPost`. */
const ADOPTION_POST_FAILURE = "injected adoption post send failure";

/**
 * Two founders leave and never author their exits; no peer runs the
 * participant-timeout check. Founder 0's leave watchdog starts its
 * self-removal dispute, and founder 1 observes it and submits its own at
 * once: one window with two disputes, none of them final. Founder 1's
 * reduction attempts are held, so founder 0 is the only reducer. Founder 0's
 * adopt-only post is parked at its send and its exit posts park before they
 * prepare. Records founder 0's scheduled tasks, both founders' exit post
 * results and host errors, and founder 1's leave logs.
 */
async function stageTwoLeaverSelfRemovals(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0);
    const forkId = h.activeForkId!;
    const reducer = h.getPeer(REDUCER_INDEX);
    const leaver = h.getPeer(LEAVER_INDEX);
    const hostErrors: string[] = [];
    const removeHostErrorListeners = [reducer, leaver].map((peer) =>
        peer.p2pInstance.onHostError((error) =>
            hostErrors.push(`${peer.index}: ${error.message}`)
        )
    );
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const reducerWatchdog = await h.rpcStub.holdScheduledTasks(
        reducer.index,
        "channel leave watchdog"
    );
    const leaverWatchdog = await h.rpcStub.holdScheduledTasks(
        leaver.index,
        "channel leave watchdog"
    );
    const leaverAttempts = await h.rpcStub.holdReductionAttempt(
        leaver.index,
        "attempt"
    );
    const adoption = await h.rpcStub.holdSnapshotPostSend(reducer.index, {
        adoptionOnly: true
    });
    const reducerPosts = await recordSnapshotPostWaitResults(h, reducer);
    await reducerPosts.holdStarts();
    const leaverPosts = await recordSnapshotPostWaitResults(h, leaver);
    const leaverLogs = await recordLeaveChannelLogs(h, leaver);
    const restore = async () => {
        for (const remove of removeHostErrorListeners) remove();
        await leaverAttempts.release();
        await leaverWatchdog.release(false);
        await adoption.release();
        await reducerPosts.restore();
        await leaverPosts.restore();
        await leaverLogs.restore();
    };
    try {
        await reducer.p2pInstance.p2pSigner.leaveChannel();
        await leaver.p2pInstance.p2pSigner.leaveChannel();
        expect(await reducerWatchdog.heldCount()).to.equal(1);
        await reducerWatchdog.release(true);
        // after the watchdog restore, which resets scheduleTask
        const reducerTasks = await h.rpcStub.recordScheduledTasks(
            reducer.index
        );
        await waitFor(async () => {
            const [window] = await h.channelManager.getDisputeWindows(
                h.channelId,
                [forkId]
            );
            return window.evidence.disputeCommitments.length === 2;
        }, h.event.protocolEventTimeoutMs());
        expect(
            await h.query.reducedForkOnChain(forkId),
            "premise: no self-removal dispute is final"
        ).to.equal(ZeroHash);
        return {
            forkId,
            reducer,
            leaver,
            hostErrors,
            leaverAttempts,
            adoption,
            reducerPosts,
            leaverPosts,
            /** `adoptReducedFork-*` retries founder 0 scheduled. */
            adoptionRetries: async () =>
                (await reducerTasks.tasks()).filter((task) =>
                    task.taskName.startsWith("adoptReducedFork-")
                ).length,
            /** Metadata of founder 1's logged exit post refusals. */
            leaverRefusals: async () =>
                (await leaverLogs.entries())
                    .filter((entry) => entry.message === EXIT_POST_REFUSED)
                    .map((entry) => entry.meta),
            restore
        };
    } catch (error) {
        await restore();
        throw error;
    }
}

/** Waits until the window's kill period has ended. */
async function waitOutKillPeriod(
    h: MathPeerTestHarness,
    forkId: ForkId
): Promise<void> {
    const windowCreatedAt = Number(
        await h.channelManager.getDisputeWindowCreationTimestamp(
            h.channelId,
            forkId
        )
    );
    await h.event.waitUntilTimestamp(
        windowCreatedAt +
            h.event.evidencePeriodWaitMs(SETTLEMENT_MARGIN_SECONDS) / 1000
    );
    const { killPeriodEnd } = await h.channelManager.isKillPeriodExpired(
        h.channelId,
        forkId
    );
    await h.event.waitUntilTimestamp(
        Number(killPeriodEnd) + SETTLEMENT_MARGIN_SECONDS
    );
}

/**
 * Waits out the window's kill period: founder 0 reduces, and its adopt-only
 * post of the reduced fork is prepared and parked at its send.
 */
async function reduceWithAdoptionParked(
    h: MathPeerTestHarness,
    staged: {
        forkId: ForkId;
        adoption: { waitUntilHeld: () => Promise<number> };
    }
): Promise<void> {
    await waitOutKillPeriod(h, staged.forkId);
    await staged.adoption.waitUntilHeld();
    expect(
        await h.query.reducedForkOnChain(staged.forkId),
        "premise: the reduce landed"
    ).to.not.equal(ZeroHash);
}

async function waitUntilChannelClosed(h: MathPeerTestHarness): Promise<void> {
    await waitFor(
        async () => !(await h.channelManager.isChannelOpen(h.channelId))[0],
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * `stageTwoLeaverSelfRemovals`, then founder 0's reduce lands with its
 * adopt-only post parked. Founder 1 then installs the reduced fork, which has
 * no participant, and its exit post of that fork closes the channel. The
 * caller releases the adoption with `adoption.release`, then founder 0's exit
 * posts with `reducerPosts.releaseStarts`, and calls `restore` in `finally`.
 */
export async function stageLeavePostClosingBeforeAdoption(
    h: MathPeerTestHarness
) {
    const staged = await stageTwoLeaverSelfRemovals(h);
    try {
        await reduceWithAdoptionParked(h, staged);
        await staged.leaverAttempts.release();
        await waitUntilChannelClosed(h);
        return staged;
    } catch (error) {
        await staged.restore();
        throw error;
    }
}

/**
 * `stageTwoLeaverSelfRemovals`, then founder 0's reduce lands with its
 * adopt-only post parked. Founder 1 then installs the reduced fork, which has
 * no participant, and its exit post of that fork is prepared and parked at
 * its send. Founder 0's adoption is then sent and closes the channel. The
 * caller releases founder 1's post with `releaseLeaverPost`, then founder 0's
 * exit posts with `reducerPosts.releaseStarts`, and calls `restore` in
 * `finally`.
 */
export async function stageAdoptionClosingBeforeLeavePost(
    h: MathPeerTestHarness
) {
    const staged = await stageTwoLeaverSelfRemovals(h);
    const leaverSend = await h.rpcStub.holdSnapshotPostSend(
        staged.leaver.index
    );
    const restore = async () => {
        await leaverSend.release();
        await staged.restore();
    };
    try {
        await reduceWithAdoptionParked(h, staged);
        await staged.leaverAttempts.release();
        await leaverSend.waitUntilHeld();
        expect(
            await staged.leaverPosts.results(),
            "premise: the parked exit post has not settled"
        ).to.deep.equal([]);
        expect(
            await staged.adoption.release(),
            "premise: the adoption is mined"
        ).to.equal(null);
        await waitUntilChannelClosed(h);
        return {
            ...staged,
            /** Sends the parked exit post; its revert name, or null when it was mined. */
            releaseLeaverPost: leaverSend.release,
            restore
        };
    } catch (error) {
        await restore();
        throw error;
    }
}

/**
 * `stageTwoLeaverSelfRemovals`, but founder 1's reduce is held at its send,
 * so at the end of the kill period it installs the reduced fork, which has no
 * participant, and never reduces. Its install-time exit post finds no reduced
 * result on chain and is parked after its no-op result. Founder 0's reduce
 * then lands, and founder 1's commit check queues a post behind the parked
 * one. Founder 0's adoption and its one retry both fail at their send with an
 * error that is not a settled outcome, so founder 0 never closes the channel.
 * The caller releases founder 1's post with `leaverPosts.releaseResults`,
 * then founder 0's exit posts with `reducerPosts.releaseStarts`, then founder
 * 1's held reduce with `leaverAttempts.release`, and calls `restore` in
 * `finally`.
 */
export async function stageCommitCheckQueuedBehindLeaverPost(
    h: MathPeerTestHarness
) {
    const staged = await stageTwoLeaverSelfRemovals(h);
    const { reducer, leaver } = staged;
    const reducerAttempts = await h.rpcStub.holdReductionAttempt(
        reducer.index,
        "attempt"
    );
    // replaces the shared step's attempt hold; `leaverAttempts.release`
    // restores it
    const leaverReduce = await h.rpcStub.holdReductionAttempt(
        leaver.index,
        "submit"
    );
    // the adoption fails at its send instead of parking there
    await staged.adoption.release();
    const adoptionFailure = await h.rpcStub.failFirstAdoptionPost(
        reducer.index,
        2
    );
    const restore = async () => {
        await reducerAttempts.release();
        await adoptionFailure.restore();
        await staged.restore();
    };
    const adoptionPosts = async () =>
        (await adoptionFailure.recorded()).filter(
            (names) =>
                names.length === 1 && names[0] === "updateStateSnapshotFork"
        ).length;
    try {
        await staged.leaverPosts.holdResults();
        await waitOutKillPeriod(h, staged.forkId);
        await waitFor(
            async () => (await leaverReduce.entered()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await staged.leaverPosts.resultsWait(1),
            "premise: the install-time post finds no reduced result"
        ).to.deep.equal(["no-op"]);
        await reducerAttempts.release();
        await waitFor(
            async () =>
                (await h.query.reducedForkOnChain(staged.forkId)) !== ZeroHash,
            h.event.protocolEventTimeoutMs()
        );
        // the commit check runs while the install-time post is parked
        await waitFor(
            () =>
                h.execOnHost(
                    leaver,
                    (sm) => sm.leaveChannelService["isPostQueued"]
                ),
            h.event.protocolEventTimeoutMs()
        );
        // the adoption and its retry fail before founder 1's post is released
        await waitFor(
            async () => (await adoptionPosts()) === 2,
            h.event.protocolEventTimeoutMs()
        );
        // the failed retry is rethrown as a detached error
        await TestSession.expectFirstDetachedError({
            includes: ADOPTION_POST_FAILURE,
            required: false
        });
        return {
            ...staged,
            /** Adopt-only posts founder 0 sent, all failed. */
            adoptionPosts,
            /** Host errors other than founder 0's failed adoption retry. */
            unexpectedHostErrors: () =>
                staged.hostErrors.filter(
                    (error) => !error.includes(ADOPTION_POST_FAILURE)
                ),
            restore
        };
    } catch (error) {
        await restore();
        throw error;
    }
}
