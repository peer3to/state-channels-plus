// @spec-test-coverage-ignore: shared timeout check staging (deadline, early window, refusals) exercised by ParticipantTimeoutService cases
import { syncTargetToUnpostedReduction } from "./ReductionForkSwitchStaging";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import Clock from "@/Clock";
import { timeoutWaitTime } from "@/types";
import type { Address, BlockHeight, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { hexlify } from "ethers";

export async function assertEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    at: "send" | "wait",
    failures: number,
    differenceSeconds = 1
): Promise<void> {
    await h.lifecycle.timeoutSetup(3);
    const peer = h.getPeer(1);
    const forkId = h.activeForkId!;
    await h.dispute.suppressDisputeInitiation([h.getPeer(2).index]);
    const held = await h.rpcStub.holdScheduledTasks(
        1,
        "timeoutParticipantAfterEarlySubmission"
    );
    const tasks = await h.rpcStub.recordScheduledTasks(1);
    const recorder = await h.rpcStub.recordDisputeSubmissions(1, {
        forward: true,
        failWith: {
            customError: "RaceConditionDisputeTimeoutNotMinTimestamp",
            customErrorArgs: [String(differenceSeconds + 1), "1"],
            at,
            times: failures
        }
    });
    try {
        await waitFor(
            async () => (await held.heldCount()) === 1,
            h.event.hostExecTimeoutMs()
        );
        expect(
            await h.execOnHost(
                peer,
                (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
                { forkId }
            )
        ).to.equal(false);
        const retryTasks = (await tasks.tasks()).filter((task) =>
            task.taskName.startsWith("timeoutParticipantAfterEarlySubmission")
        );
        expect(retryTasks).to.have.length(1);
        expect(retryTasks[0].delayMs).to.equal(
            Math.max(1, differenceSeconds) * 1000
        );
        await held.release(true);
        await h.assert.dispute.committedWait({
            peersIndices: [1],
            expectedCount: 1,
            mode: "atLeast"
        });
        const submissions = await recorder.submissions();
        expect(submissions).to.have.length(failures + 1);
        const original = Codec.decode(
            submissions[0].encodedDispute,
            Type.Dispute
        );
        for (const submission of submissions.slice(1)) {
            const retried = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(retried.input.timeout).to.deep.equal(original.input.timeout);
        }
        expect(
            await h.execOnHost(
                peer,
                (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
                { forkId }
            )
        ).to.equal(true);
    } finally {
        await held.release(false);
        await recorder.restore();
        await tasks.restore();
    }
}

export async function assertObsoleteEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    change: "block" | "disposed"
): Promise<void> {
    await h.lifecycle.start(3, 0, {
        configOverrides:
            change === "disposed" ? { RUN_SDK_IN_THREAD: false } : {}
    });
    const peer = h.getPeer(1);
    const local =
        change === "disposed"
            ? runtimeEndpointFor(peer.p2pInstance)
            : undefined;
    const forkId = h.activeForkId!;
    const held = await h.rpcStub.holdScheduledTasks(
        1,
        "timeoutParticipantAfterEarlySubmission"
    );
    const state = await h.execOnHost(peer, (sm) => ({
        timestamp: sm.storage.getPreviousBlockOrSnapshot({
            forkId: sm.forkId,
            height: 0
        }).stateSnapshot!.timestamp,
        timeConfig: sm.timeConfig
    }));
    const minimum = state.timestamp + timeoutWaitTime(state.timeConfig, 0);
    const recorder = await h.rpcStub.recordDisputeSubmissions(1, {
        failWith: {
            customError: "RaceConditionDisputeTimeoutNotMinTimestamp",
            customErrorArgs: [String(minimum), String(minimum - 1)],
            at: "send",
            times: 1
        }
    });
    try {
        // Enter the real timeout constructor before the local deadline. The
        // chain-boundary refusal then schedules the check under test.
        await h.execOnHost(
            peer,
            (sm, args) =>
                sm.participantTimeoutService["createTimeOutDispute"](
                    args.forkId,
                    0,
                    args.writer,
                    args.minimum
                ),
            { forkId, writer: h.getPeer(0).address, minimum }
        );
        await waitFor(async () => (await held.heldCount()) === 1);
        expect(await recorder.submissions()).to.have.length(1);
        if (change === "block") {
            await h.transition.advanceState();
        } else if (local) {
            local.sm.abort();
            // Run the held retry after abort; observe final cleanup locally.
            local.stub.restoreHeldScheduledTasks(
                "timeoutParticipantAfterEarlySubmission",
                true
            );
            await local.host.dispose();
            expect(
                local.stub.getRecordedDisputeSubmissions().submissions
            ).to.have.length(1);
            return;
        }
        await held.release(true);
        expect(await recorder.submissions()).to.have.length(1);
    } finally {
        if (local) {
            local.stub.restoreHeldScheduledTasks(
                "timeoutParticipantAfterEarlySubmission",
                false
            );
            local.stub.restoreDisputeSubmissions();
            await local.host.dispose();
        } else {
            await held.release(false);
            await recorder.restore();
        }
    }
}

export async function assertTimeoutRetryAfterForkSwitch(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const target = h.getPeer(0);
    const held = await h.rpcStub.holdScheduledTasks(
        0,
        "timeoutParticipantAfterEarlySubmission"
    );
    const tasks = await h.rpcStub.recordScheduledTasks(0);
    const recorder = await h.rpcStub.recordDisputeSubmissions(0);
    let responderHold: { release(): Promise<void> } | undefined;
    try {
        await h.execOnHost(
            target,
            (sm, args) => {
                sm.participantTimeoutService.scheduleCheck(
                    args.forkId,
                    sm.storage.blocks.getNextBlockHeight(args.forkId),
                    args.participant,
                    1,
                    "timeoutParticipantAfterEarlySubmission"
                );
            },
            { forkId: sourceForkId, participant: h.getPeer(2).address }
        );
        await waitFor(async () => (await held.heldCount()) === 1);
        responderHold = (
            await syncTargetToUnpostedReduction(h, 0, 2, sourceForkId)
        ).responderHold;
        const before = await h
            .control(target)
            .query.getTimeout(sourceForkId)
            .request();
        const oldForkTasks = async () =>
            (await tasks.tasks()).filter(
                (task) =>
                    task.taskName.startsWith("timeoutParticipant") &&
                    task.taskName.includes(hexlify(sourceForkId))
            );
        const count = (await oldForkTasks()).length;
        await held.release(true);
        // New attempts to queue that same old-fork check must also be ignored.
        await h.execOnHost(
            target,
            (sm, args) => {
                sm.participantTimeoutService.scheduleCheck(
                    args.forkId,
                    0,
                    args.participant,
                    1,
                    "timeoutParticipantAfterEarlySubmission"
                );
            },
            { forkId: sourceForkId, participant: h.getPeer(2).address }
        );
        expect(await recorder.submissions()).to.deep.equal([]);
        expect(
            await h.control(target).query.getTimeout(sourceForkId).request()
        ).to.deep.equal(before);
        expect((await oldForkTasks()).length).to.equal(count);
    } finally {
        await held.release(false);
        await recorder.restore();
        await tasks.restore();
        await responderHold?.release();
    }
}

/**
 * Waits past the writer's timeout deadline exactly as the observer's check
 * computes it, then runs that real check once.
 */
export async function checkTimeoutAfterDeadline(
    h: MathPeerTestHarness,
    observerIndex: number,
    args: {
        forkId: ForkId;
        height: BlockHeight;
        writer: Address;
        isForced: boolean;
    }
): Promise<void> {
    const observer = h.getPeer(observerIndex);
    const { relevantTimestamp, timeConfig } = await h.execOnHost(
        observer,
        (sm, args) => ({
            relevantTimestamp: sm.storage
                .getPreviousBlockOrSnapshot({
                    forkId: args.forkId,
                    height: args.height
                })
                .block!.getRelevantTimestamp(args.writer),
            timeConfig: sm.timeConfig
        }),
        args
    );
    const deadline =
        relevantTimestamp + timeoutWaitTime(timeConfig, args.height);
    await waitFor(
        // one second of slack for the host clock's own rounding
        async () => Clock.getTimeInSeconds() > deadline + 1,
        h.event.hostExecTimeoutMs()
    );
    await h.execOnHost(
        observer,
        (sm, args) =>
            sm.participantTimeoutService["tryTimeoutParticipant"](
                args.forkId,
                args.height,
                args.writer,
                args.isForced
            ),
        args,
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * Participant 1 opens a real self-removal dispute window before the next
 * writer's timeout deadline, and the observer's reductions are held so the
 * fork stays active past that deadline. The observer's uploads are recorded,
 * not sent.
 */
export async function stageWindowBeforeTimeoutDeadline(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    const observer = h.getPeer(0);
    const forkId = h.activeForkId!;
    const writerAddress = await h
        .control(observer)
        .query.getNextToWrite()
        .request();
    const writer = h.peers.find((peer) => peer.address === writerAddress)!;
    const race = await h.rpcStub.holdReductionRace(observer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(observer.index);
    await h.execOnHost(h.getPeer(1), (sm) =>
        sm.membershipService.startSelfRemovalDispute(sm.forkId)
    );
    await waitFor(
        async () =>
            await h.execOnHost(
                observer,
                async (sm, args) =>
                    Number(
                        await sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                            sm.channelId,
                            args.forkId
                        )
                    ) !== 0,
                { forkId }
            ),
        h.event.hostExecTimeoutMs()
    );
    return {
        observer,
        writer,
        forkId,
        height: 2,
        recorder,
        restore: async () => {
            await recorder.restore();
            await race.release({ replayEvents: false, keepTasksHeld: true });
        }
    };
}
