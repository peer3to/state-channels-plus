// @spec-test-coverage-ignore: shared timeout-refusal staging exercised by ParticipantTimeoutService cases
import { syncTargetToUnpostedReduction } from "./ReductionForkSwitchStaging";
import { expect } from "chai";
import { hexlify } from "ethers";
import { timeoutWaitTime } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

export async function assertEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    at: "send" | "wait",
    failures: number,
    differenceSeconds = 1
): Promise<void> {
    await h.lifecycle.timeoutSetup(3);
    const peer = h.getPeer(1);
    const forkId = h.activeForkId!;
    await h
        .control(h.getPeer(2))
        .stub.stubSuppressDisputeInitiation()
        .request();
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
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }) * 2
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
    await h.lifecycle.start(3);
    const peer = h.getPeer(1);
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
        } else {
            await h.control(peer).stub.abortDetached().request();
            await waitFor(async () =>
                h.execOnHost(peer, (sm) => sm.isDisposed)
            );
        }
        await held.release(true);
        expect(await recorder.submissions()).to.have.length(1);
    } finally {
        await held.release(false);
        await recorder.restore();
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
