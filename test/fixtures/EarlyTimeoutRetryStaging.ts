// @spec-test-coverage-ignore: shared timeout check staging (deadline, early window, refusals) exercised by ParticipantTimeoutService cases
import { syncTargetToUnpostedReduction } from "./ReductionForkSwitchStaging";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import Clock from "@/Clock";
import { timeoutWaitTime } from "@/types";
import type { Address, BlockHeight, ForkId } from "@/types/types";
import { Codec, Type, sleep } from "@/utils";
import type { RaceConditionErrorName } from "@/utils/evmErrorHandler";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import type { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { hexlify } from "ethers";

export const EARLY_TIMEOUT_RETRY_REASON =
    "timeoutParticipantAfterEarlySubmission";
export const MISMATCH_TIMEOUT_RETRY_REASON =
    "timeoutParticipantAfterPreviousProducerMismatch";
export const MISMATCH_TIMEOUT_ERROR =
    "RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch";

export type TimeoutRetryRefusal = {
    customError?: RaceConditionErrorName;
    customErrorArgs?: string[];
    // Builds mismatch args from the real predecessor slot once staging knows
    // it. Peer addresses only exist after channel setup, so mismatch callers
    // pass the direction here instead of precomputing args up front.
    mismatchDirection?: {
        expectedPosted: boolean;
        foundPosted: boolean;
    };
};

function retryReasonFor(customError: string | undefined): string {
    return customError === MISMATCH_TIMEOUT_ERROR
        ? MISMATCH_TIMEOUT_RETRY_REASON
        : EARLY_TIMEOUT_RETRY_REASON;
}

export function mismatchRefusalArgs(
    producer: string,
    height: number,
    expectedPosted: boolean,
    foundPosted: boolean
): string[] {
    // customErrorArgs is typed string[], but the string "false" is truthy and
    // would ABI-encode as true, collapsing both directions into one. Real
    // booleans keep the refused (expected, found) pair exact; the cast only
    // satisfies the string[] boundary into the stub's revert encoder.
    return [
        producer,
        String(height),
        expectedPosted,
        foundPosted
    ] as unknown as string[];
}

export async function assertEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    at: "send" | "wait",
    failures: number,
    differenceSeconds = 1,
    refusal?: TimeoutRetryRefusal
): Promise<{ refusedTimeout: TimeoutStruct; committedTimeout: TimeoutStruct }> {
    const isMismatch = refusal?.customError === MISMATCH_TIMEOUT_ERROR;
    await h.lifecycle.timeoutSetup(3);
    if (isMismatch) {
        await h.transition.advanceState();
    }
    const observerIndex = isMismatch ? 2 : 1;
    const peer = h.getPeer(observerIndex);
    const forkId = h.activeForkId!;
    await h.dispute.suppressDisputeInitiation([
        h.getPeer(isMismatch ? 0 : 2).index
    ]);
    const retryReason = retryReasonFor(refusal?.customError);
    const expectedDelayMs = isMismatch
        ? 1000
        : Math.max(1, differenceSeconds) * 1000;
    const direction = refusal?.mismatchDirection ?? {
        expectedPosted: false,
        foundPosted: true
    };
    const refusalArgs =
        refusal?.customErrorArgs ??
        (isMismatch
            ? mismatchRefusalArgs(
                  h.getPeer(0).address,
                  0,
                  direction.expectedPosted,
                  direction.foundPosted
              )
            : [String(differenceSeconds + 1), "1"]);
    // Hold before recording: a held re-arm only reaches the recorder when the
    // hold wraps outside it. Releasing the hold restores the pre-record
    // scheduler, so re-arms queued after the release are invisible here;
    // their attempts (counted below) carry that half of the proof instead.
    const held = await h.rpcStub.holdScheduledTasks(observerIndex, retryReason);
    const tasks = await h.rpcStub.recordScheduledTasks(observerIndex);
    const recorder = await h.rpcStub.recordDisputeSubmissions(observerIndex, {
        forward: true,
        failWith: {
            customError:
                refusal?.customError ??
                "RaceConditionDisputeTimeoutNotMinTimestamp",
            customErrorArgs: refusalArgs,
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
            task.taskName.startsWith(retryReason)
        );
        expect(retryTasks).to.have.length(1);
        expect(retryTasks[0].delayMs).to.equal(expectedDelayMs);
        if (failures > 1) {
            await sleep(1000);
            expect(await held.heldCount()).to.equal(1);
            expect(await recorder.submissions()).to.have.length(1);
        }
        await held.release(true);
        await waitFor(
            async () => (await recorder.submissions()).length === failures + 1,
            h.event.hostExecTimeoutMs()
        );
        await h.assert.dispute.committedWait({
            peersIndices: [observerIndex],
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
        // Exactly one re-arm is ever recorded: the held first one. Later
        // re-arms are scheduled after the hold's release, past the recorder
        // (see above), so their count is proven by the attempt count instead.
        expect(
            (await tasks.tasks()).filter((task) =>
                task.taskName.startsWith(retryReason)
            )
        ).to.have.length(1);
        const committed = Codec.decode(
            submissions[submissions.length - 1].encodedDispute,
            Type.Dispute
        );
        return {
            refusedTimeout: original.input.timeout,
            committedTimeout: committed.input.timeout
        };
    } finally {
        await held.release(false);
        await recorder.restore();
        await tasks.restore();
    }
}

/**
 * Two consecutive predecessor-mismatch refusals, each re-arm held and
 * released alone, then one committed timeout. The second refusal is driven by
 * re-running the check on the host instead of releasing several held tasks
 * at once, so every scheduled re-arm is individually observed and no bulk
 * release can hide spin.
 */
export async function assertConsecutiveMismatchRetry(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.timeoutSetup(3);
    await h.transition.advanceState();
    const observerIndex = 2;
    const peer = h.getPeer(observerIndex);
    const writer = h.getPeer(1);
    const predecessor = h.getPeer(0);
    const forkId = h.activeForkId!;
    await h.dispute.suppressDisputeInitiation([predecessor.index]);
    const refusalArgs = mismatchRefusalArgs(
        predecessor.address,
        0,
        false,
        true
    );
    const didDispute = () =>
        h.execOnHost(
            peer,
            (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
            { forkId }
        );
    const held = await h.rpcStub.holdScheduledTasks(
        observerIndex,
        MISMATCH_TIMEOUT_RETRY_REASON
    );
    const tasks = await h.rpcStub.recordScheduledTasks(observerIndex);
    const recorder = await h.rpcStub.recordDisputeSubmissions(observerIndex, {
        forward: true,
        failWith: {
            customError: MISMATCH_TIMEOUT_ERROR,
            customErrorArgs: refusalArgs,
            at: "send",
            times: 1
        }
    });
    let firstEncoded: string;
    try {
        await waitFor(
            async () => (await held.heldCount()) === 1,
            h.event.hostExecTimeoutMs()
        );
        expect(await didDispute()).to.equal(false);
        const parked = (await tasks.tasks()).filter((task) =>
            task.taskName.startsWith(MISMATCH_TIMEOUT_RETRY_REASON)
        );
        expect(parked).to.have.length(1);
        expect(parked[0].delayMs).to.equal(1000);
        await sleep(1000);
        expect(await held.heldCount()).to.equal(1);
        const first = await recorder.submissions();
        expect(first).to.have.length(1);
        firstEncoded = first[0].encodedDispute;
    } finally {
        await held.release(false);
        await recorder.restore();
        await tasks.restore();
    }
    const heldAgain = await h.rpcStub.holdScheduledTasks(
        observerIndex,
        MISMATCH_TIMEOUT_RETRY_REASON
    );
    const tasksAgain = await h.rpcStub.recordScheduledTasks(observerIndex);
    const recorderAgain = await h.rpcStub.recordDisputeSubmissions(
        observerIndex,
        {
            forward: true,
            failWith: {
                customError: MISMATCH_TIMEOUT_ERROR,
                customErrorArgs: refusalArgs,
                at: "send",
                times: 1
            }
        }
    );
    try {
        await h.execOnHost(
            peer,
            async (sm, args) => {
                await sm.participantTimeoutService["tryTimeoutParticipant"](
                    args.forkId,
                    args.height,
                    args.writer
                );
                return true;
            },
            { forkId, height: 1, writer: writer.address },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        await waitFor(
            async () => (await heldAgain.heldCount()) === 1,
            h.event.hostExecTimeoutMs()
        );
        expect(await didDispute()).to.equal(false);
        const parkedAgain = (await tasksAgain.tasks()).filter((task) =>
            task.taskName.startsWith(MISMATCH_TIMEOUT_RETRY_REASON)
        );
        expect(parkedAgain).to.have.length(1);
        expect(parkedAgain[0].delayMs).to.equal(1000);
        expect(await recorderAgain.submissions()).to.have.length(1);
        await heldAgain.release(true);
        await waitFor(
            async () => (await recorderAgain.submissions()).length === 2,
            h.event.hostExecTimeoutMs()
        );
        await h.assert.dispute.committedWait({
            peersIndices: [observerIndex],
            expectedCount: 1,
            mode: "atLeast"
        });
        const submissions = await recorderAgain.submissions();
        expect(submissions).to.have.length(2);
        const original = Codec.decode(firstEncoded, Type.Dispute);
        for (const encoded of [
            submissions[0].encodedDispute,
            submissions[1].encodedDispute
        ]) {
            expect(
                Codec.decode(encoded, Type.Dispute).input.timeout
            ).to.deep.equal(original.input.timeout);
        }
        expect(await didDispute()).to.equal(true);
    } finally {
        await heldAgain.release(false);
        await recorderAgain.restore();
        await tasksAgain.restore();
    }
}

export async function assertObsoleteEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    change: "block" | "disposed",
    refusal?: TimeoutRetryRefusal
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
    const retryReason = retryReasonFor(refusal?.customError);
    const held = await h.rpcStub.holdScheduledTasks(1, retryReason);
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
            customError:
                refusal?.customError ??
                "RaceConditionDisputeTimeoutNotMinTimestamp",
            customErrorArgs: refusal?.customErrorArgs ?? [
                String(minimum),
                String(minimum - 1)
            ],
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
            local.stub.restoreHeldScheduledTasks(retryReason, true);
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
            local.stub.restoreHeldScheduledTasks(retryReason, false);
            local.stub.restoreDisputeSubmissions();
            await local.host.dispose();
        } else {
            await held.release(false);
            await recorder.restore();
        }
    }
}

export async function assertTimeoutRetryAfterForkSwitch(
    h: MathPeerTestHarness,
    retryReason = EARLY_TIMEOUT_RETRY_REASON
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const target = h.getPeer(0);
    const held = await h.rpcStub.holdScheduledTasks(0, retryReason);
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
                    args.retryReason
                );
            },
            {
                forkId: sourceForkId,
                participant: h.getPeer(2).address,
                retryReason
            }
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
        const submissionsBefore = (await recorder.submissions()).length;
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
                    args.retryReason
                );
            },
            {
                forkId: sourceForkId,
                participant: h.getPeer(2).address,
                retryReason
            }
        );
        expect(await recorder.submissions()).to.deep.equal([]);
        expect((await recorder.submissions()).length).to.equal(
            submissionsBefore
        );
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
