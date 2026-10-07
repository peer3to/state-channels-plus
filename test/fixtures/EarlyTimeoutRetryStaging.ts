// @spec-test-coverage-ignore: shared timeout check staging (deadline, early window, refusals) exercised by ParticipantTimeoutService cases
import { syncTargetToUnpostedReduction } from "./ReductionForkSwitchStaging";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import Clock from "@/Clock";
import {
    EARLY_TIMEOUT_RECHECK_REASON,
    MISMATCH_TIMEOUT_RECHECK_REASON
} from "@/stateManager/chainFallback/ParticipantTimeoutService";
import { timeoutWaitTime } from "@/types";
import type { Address, BlockHeight, ForkId } from "@/types/types";
import { Codec, Type, sleep } from "@/utils";
import type { CustomErrorArg } from "@test/factory";
import type {
    DisputeSubmissionFailureSpec,
    RecordedDisputeSubmission
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroAddress, hexlify } from "ethers";

export const MISMATCH_TIMEOUT_ERROR =
    "RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch";

/** The refused (expected, found) posting state of the previous producer. */
export type MismatchDirection = {
    expectedPosted: boolean;
    foundPosted: boolean;
};

export function mismatchRefusalArgs(
    producer: string,
    height: number,
    { expectedPosted, foundPosted }: MismatchDirection
): CustomErrorArg[] {
    // Real booleans: the string "false" is truthy and would ABI-encode as true.
    return [producer, String(height), expectedPosted, foundPosted];
}

/**
 * Hold, task recorder and submission recorder for one peer's re-armed timeout
 * check, with a single teardown. Hold before recording: a held re-arm only
 * reaches the recorder when the hold wraps outside it. Releasing the hold
 * restores the pre-record scheduler, so re-arms queued after the release are
 * invisible here; callers prove those through the submission count instead.
 */
async function installRetryProbes(
    h: MathPeerTestHarness,
    peerIndex: number,
    reason: string,
    failWith: DisputeSubmissionFailureSpec
) {
    const held = await h.rpcStub.holdScheduledTasks(peerIndex, reason);
    const tasks = await h.rpcStub.recordScheduledTasks(peerIndex);
    const recorder = await h.rpcStub.recordDisputeSubmissions(peerIndex, {
        forward: true,
        failWith
    });
    return {
        held,
        recorder,
        retryTasks: async () =>
            (await tasks.tasks()).filter((task) =>
                task.taskName.startsWith(reason)
            ),
        // One refusal so far, and its re-arm is held after exactly `delayMs`.
        expectOneHeldRearm: async (delayMs: number) => {
            await waitFor(
                async () => (await held.heldCount()) === 1,
                h.event.hostExecTimeoutMs()
            );
            const parked = (await tasks.tasks()).filter((task) =>
                task.taskName.startsWith(reason)
            );
            expect(parked).to.have.length(1);
            expect(parked[0].delayMs).to.equal(delayMs);
            expect(await recorder.submissions()).to.have.length(1);
        },
        restore: async () => {
            await held.release(false);
            await recorder.restore();
            await tasks.restore();
        }
    };
}

function didDispute(h: MathPeerTestHarness, peerIndex: number, forkId: ForkId) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
        { forkId }
    );
}

/** Every submission must carry the same timeout as the first, refused one. */
function expectSameTimeout(encodedDisputes: string[]): void {
    const timeouts = encodedDisputes.map(
        (encoded) => Codec.decode(encoded, Type.Dispute).input.timeout
    );
    for (const timeout of timeouts.slice(1))
        expect(timeout).to.deep.equal(timeouts[0]);
}

export async function assertEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    at: "send" | "wait",
    failures: number,
    differenceSeconds = 1,
    mismatch?: MismatchDirection
): Promise<void> {
    await h.lifecycle.timeoutSetup(3);
    // A mismatch needs a stored predecessor block: advance once, so peer 0
    // authored it and observer 2 times out writer 1. Delays are literal so a
    // changed TIMEOUT_RECHECK_DELAY_MS turns these checks red.
    if (mismatch) await h.transition.advanceState();
    const scenario = mismatch
        ? {
              observerIndex: 2,
              suppressedIndex: 0,
              reason: MISMATCH_TIMEOUT_RECHECK_REASON,
              delayMs: 1000,
              failWith: {
                  customError: MISMATCH_TIMEOUT_ERROR,
                  customErrorArgs: mismatchRefusalArgs(
                      h.getPeer(0).address,
                      0,
                      mismatch
                  ),
                  at,
                  times: failures
              } satisfies DisputeSubmissionFailureSpec
          }
        : {
              observerIndex: 1,
              suppressedIndex: 2,
              reason: EARLY_TIMEOUT_RECHECK_REASON,
              delayMs: Math.max(1, differenceSeconds) * 1000,
              failWith: {
                  customError: "RaceConditionDisputeTimeoutNotMinTimestamp",
                  customErrorArgs: [String(differenceSeconds + 1), "1"],
                  at,
                  times: failures
              } satisfies DisputeSubmissionFailureSpec
          };
    const forkId = h.activeForkId!;
    await h.dispute.suppressDisputeInitiation([
        h.getPeer(scenario.suppressedIndex).index
    ]);
    const probes = await installRetryProbes(
        h,
        scenario.observerIndex,
        scenario.reason,
        scenario.failWith
    );
    try {
        await probes.expectOneHeldRearm(scenario.delayMs);
        expect(await didDispute(h, scenario.observerIndex, forkId)).to.equal(
            false
        );
        if (failures > 1) {
            // While the first re-arm is held nothing else may submit (no spin).
            await sleep(1000);
            expect(await probes.held.heldCount()).to.equal(1);
            expect(await probes.recorder.submissions()).to.have.length(1);
        }
        await probes.held.release(true);
        await waitFor(
            async () =>
                (await probes.recorder.submissions()).length === failures + 1,
            h.event.hostExecTimeoutMs()
        );
        await h.assert.dispute.committedWait({
            peersIndices: [scenario.observerIndex],
            expectedCount: 1,
            mode: "atLeast"
        });
        const submissions = await probes.recorder.submissions();
        expect(submissions).to.have.length(failures + 1);
        expectSameTimeout(
            submissions.map((submission) => submission.encodedDispute)
        );
        expect(await didDispute(h, scenario.observerIndex, forkId)).to.equal(
            true
        );
        // Exactly one re-arm is ever recorded: the held first one. Later
        // re-arms are scheduled after the hold's release, past the recorder
        // (see above), so their count is proven by the attempt count instead.
        expect(await probes.retryTasks()).to.have.length(1);
    } finally {
        await probes.restore();
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
    const failWith: DisputeSubmissionFailureSpec = {
        customError: MISMATCH_TIMEOUT_ERROR,
        customErrorArgs: mismatchRefusalArgs(predecessor.address, 0, {
            expectedPosted: false,
            foundPosted: true
        }),
        at: "send",
        times: 1
    };
    let firstEncoded: string;
    const first = await installRetryProbes(
        h,
        observerIndex,
        MISMATCH_TIMEOUT_RECHECK_REASON,
        failWith
    );
    try {
        await first.expectOneHeldRearm(1000);
        expect(await didDispute(h, observerIndex, forkId)).to.equal(false);
        await sleep(1000);
        expect(await first.held.heldCount()).to.equal(1);
        firstEncoded = (await first.recorder.submissions())[0].encodedDispute;
    } finally {
        await first.restore();
    }

    const second = await installRetryProbes(
        h,
        observerIndex,
        MISMATCH_TIMEOUT_RECHECK_REASON,
        failWith
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
        await second.expectOneHeldRearm(1000);
        expect(await didDispute(h, observerIndex, forkId)).to.equal(false);
        await second.held.release(true);
        await waitFor(
            async () => (await second.recorder.submissions()).length === 2,
            h.event.hostExecTimeoutMs()
        );
        await h.assert.dispute.committedWait({
            peersIndices: [observerIndex],
            expectedCount: 1,
            mode: "atLeast"
        });
        const submissions = await second.recorder.submissions();
        expect(submissions).to.have.length(2);
        expectSameTimeout([
            firstEncoded,
            ...submissions.map((submission) => submission.encodedDispute)
        ]);
        expect(await didDispute(h, observerIndex, forkId)).to.equal(true);
    } finally {
        await second.restore();
    }
}

export async function assertObsoleteEarlyTimeoutRetry(
    h: MathPeerTestHarness,
    change: "block" | "disposed",
    refusal: "early" | "mismatch" = "early"
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
    const retryReason =
        refusal === "mismatch"
            ? MISMATCH_TIMEOUT_RECHECK_REASON
            : EARLY_TIMEOUT_RECHECK_REASON;
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
        failWith:
            refusal === "mismatch"
                ? {
                      customError: MISMATCH_TIMEOUT_ERROR,
                      // Height 0 has no predecessor block on this channel.
                      customErrorArgs: mismatchRefusalArgs(ZeroAddress, 0, {
                          expectedPosted: false,
                          foundPosted: true
                      }),
                      at: "send",
                      times: 1
                  }
                : {
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
            local.stub.restoreHeldScheduledTasks(retryReason, true);
            await local.host.dispose();
            expect(
                local.stub.getRecordedDisputeSubmissions().submissions
            ).to.have.length(1);
            return;
        }
        await held.release(true);
        expect(await recorder.submissions()).to.have.length(1);
        if (refusal === "mismatch") {
            // The chain refused this claim for good, so it must not stay
            // stored for a later dispute on the fork to carry.
            expect(
                await h.control(peer).query.getTimeout(forkId).request()
            ).to.equal(null);
            await h.execOnHost(peer, (sm) =>
                sm.membershipService.startSelfRemovalDispute(sm.forkId)
            );
            const submissions = await recorder.submissions();
            expect(submissions).to.have.length(2);
            expect(
                Codec.decode(submissions[1].encodedDispute, Type.Dispute).input
                    .timeout.participant
            ).to.equal(ZeroAddress);
        }
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
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const target = h.getPeer(0);
    const held = await h.rpcStub.holdScheduledTasks(
        0,
        EARLY_TIMEOUT_RECHECK_REASON
    );
    const tasks = await h.rpcStub.recordScheduledTasks(0);
    const recorder = await h.rpcStub.recordDisputeSubmissions(0);
    try {
        await h.execOnHost(
            target,
            (sm, args) => {
                sm.participantTimeoutService.scheduleCheck(
                    args.forkId,
                    sm.storage.blocks.getNextBlockHeight(args.forkId),
                    args.participant,
                    1,
                    args.reason
                );
            },
            {
                forkId: sourceForkId,
                participant: h.getPeer(2).address,
                reason: EARLY_TIMEOUT_RECHECK_REASON
            }
        );
        await waitFor(async () => (await held.heldCount()) === 1);
        await expectOldForkCheckIgnored(
            h,
            sourceForkId,
            EARLY_TIMEOUT_RECHECK_REASON,
            {
                runHeld: held.runHeld,
                submissions: recorder.submissions,
                tasks: tasks.tasks
            },
            "none"
        );
    } finally {
        await held.release(false);
        await recorder.restore();
        await tasks.restore();
    }
}

/**
 * An injected previous-producer mismatch refusal (the stub fails the upload
 * at send) queues the real handler's re-arm on the target's
 * fork before that fork is disputed; a verified sync then replaces the fork.
 * The released re-arm, and any later schedule of that old-fork check, must
 * create no work.
 */
export async function assertMismatchRetryAfterForkSwitch(
    h: MathPeerTestHarness
): Promise<void> {
    let probes:
        | {
              release: (runHeld: boolean) => Promise<void>;
              runHeld: () => Promise<{ ran: number; errors: string[] }>;
              submissions: () => Promise<RecordedDisputeSubmission[]>;
              tasks: () => Promise<{ taskName: string; delayMs: number }[]>;
              restore: () => Promise<void>;
          }
        | undefined;
    try {
        const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
            beforeDispute: async () => {
                const target = h.getPeer(0);
                const forkId = h.activeForkId!;
                const writer = await h
                    .control(target)
                    .query.getNextToWrite()
                    .request();
                const installed = await installRetryProbes(
                    h,
                    0,
                    MISMATCH_TIMEOUT_RECHECK_REASON,
                    {
                        customError: MISMATCH_TIMEOUT_ERROR,
                        customErrorArgs: mismatchRefusalArgs(ZeroAddress, 0, {
                            expectedPosted: false,
                            foundPosted: true
                        }),
                        at: "send",
                        times: 1
                    }
                );
                const tasks = await h.rpcStub.recordScheduledTasks(0);
                probes = {
                    release: installed.held.release,
                    runHeld: installed.held.runHeld,
                    submissions: installed.recorder.submissions,
                    tasks: tasks.tasks,
                    restore: async () => {
                        await installed.restore();
                        await tasks.restore();
                    }
                };
                // the stub refuses the target's own timeout upload; the real
                // handler queues the held re-arm on the still-current fork
                await h.execOnHost(
                    target,
                    (sm, args) =>
                        sm.participantTimeoutService["createTimeOutDispute"](
                            args.forkId,
                            sm.storage.blocks.getNextBlockHeight(args.forkId),
                            args.writer,
                            0
                        ),
                    { forkId, writer }
                );
                await installed.expectOneHeldRearm(1000);
            }
        });
        // the first upload is the refused timeout claim against the writer
        const [refused] = await probes!.submissions();
        expect(
            Codec.decode(refused.encodedDispute, Type.Dispute).input.timeout
                .participant
        ).to.not.equal(ZeroAddress);
        await expectOldForkCheckIgnored(
            h,
            sourceForkId,
            MISMATCH_TIMEOUT_RECHECK_REASON,
            probes!,
            "nothing-new"
        );
    } finally {
        await probes?.release(false);
        await probes?.restore();
    }
}

// Sync the target past `sourceForkId`, release its held old-fork re-arm, then
// queue that same old-fork check again: neither may submit, touch the old
// fork's timeout, or schedule more old-fork work.
async function expectOldForkCheckIgnored(
    h: MathPeerTestHarness,
    sourceForkId: ForkId,
    reason: string,
    probes: {
        runHeld: () => Promise<{ ran: number; errors: string[] }>;
        submissions: () => Promise<RecordedDisputeSubmission[]>;
        tasks: () => Promise<{ taskName: string; delayMs: number }[]>;
    },
    // "none": the target must never have uploaded; "nothing-new": uploads the
    // caller already accounted for may exist, but none may follow the release
    uploads: "none" | "nothing-new"
): Promise<void> {
    const target = h.getPeer(0);
    const { responderHold } = await syncTargetToUnpostedReduction(
        h,
        0,
        2,
        sourceForkId
    );
    try {
        const before = await h
            .control(target)
            .query.getTimeout(sourceForkId)
            .request();
        const oldForkTasks = async () =>
            (await probes.tasks()).filter(
                (task) =>
                    task.taskName.startsWith("timeoutParticipant") &&
                    task.taskName.includes(hexlify(sourceForkId))
            );
        const count = (await oldForkTasks()).length;
        const submitted = (await probes.submissions()).length;
        // the held old-fork re-arm really runs, to completion, without error
        expect(await probes.runHeld()).to.deep.equal({ ran: 1, errors: [] });
        // New attempts to queue that same old-fork check must also be ignored.
        await h.execOnHost(
            target,
            (sm, args) => {
                sm.participantTimeoutService.scheduleCheck(
                    args.forkId,
                    0,
                    args.participant,
                    1,
                    args.reason
                );
            },
            {
                forkId: sourceForkId,
                participant: h.getPeer(2).address,
                reason
            }
        );
        if (uploads === "none")
            expect(await probes.submissions()).to.deep.equal([]);
        else expect((await probes.submissions()).length).to.equal(submitted);
        expect(
            await h.control(target).query.getTimeout(sourceForkId).request()
        ).to.deep.equal(before);
        expect((await oldForkTasks()).length).to.equal(count);
    } finally {
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
