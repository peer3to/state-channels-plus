import { TIMEOUT_RECHECK_DELAY_MS } from "@/stateManager/chainFallback/ParticipantTimeoutService";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import {
    MISMATCH_TIMEOUT_ERROR,
    MISMATCH_TIMEOUT_RETRY_REASON,
    assertEarlyTimeoutRetry,
    assertTimeoutRetryAfterForkSwitch,
    assertObsoleteEarlyTimeoutRetry,
    assertConsecutiveMismatchRetry,
    checkTimeoutAfterDeadline,
    mismatchRefusalArgs,
    stageWindowBeforeTimeoutDeadline
} from "@test/fixtures/EarlyTimeoutRetryStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

// the guard cases call tryTimeoutParticipant directly with the dispute
// submission recorder installed, so a guard that failed to hold would show up
// as a recorded submission. the real timeout at the top is the positive
// control: the same code path does submit when the deadline really passed.

describe("Unit: ParticipantTimeoutService", function () {
    it("a block arriving during timeout construction prevents the late timeout store", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const peer = h.getPeer(2);
        const writer = h.getPeer(1);
        await h.control(peer).stub.holdTimeoutBuild().request();
        const construct = h
            .control(peer)
            .stub.startTimeoutConstruction(writer.address)
            .request();
        try {
            await waitFor(
                async () =>
                    (
                        await h
                            .control(peer)
                            .stub.getTimeoutBuildObservation()
                            .request()
                    ).entered === 1
            );
            await h.transition.advanceState();
            expect(
                await h
                    .control(peer)
                    .query.getBlockByHeight(h.activeForkId!, 1)
                    .request()
            ).to.not.equal(null);
            await h.control(peer).stub.releaseTimeoutBuild().request();
            await construct;
            expect(
                (
                    await h
                        .control(peer)
                        .stub.getTimeoutBuildObservation()
                        .request()
                ).stored
            ).to.equal(0);
        } finally {
            await h.control(peer).stub.restoreTimeoutBuildRecording().request();
        }
    });

    it("timeout construction stores one timeout when no block arrives during the hold", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const peer = h.getPeer(2);
        const writer = h.getPeer(1);
        await h.control(peer).stub.holdTimeoutBuild().request();
        const construct = h
            .control(peer)
            .stub.startTimeoutConstruction(writer.address)
            .request();
        try {
            await waitFor(
                async () =>
                    (
                        await h
                            .control(peer)
                            .stub.getTimeoutBuildObservation()
                            .request()
                    ).entered === 1
            );
            await h.control(peer).stub.releaseTimeoutBuild().request();
            await construct;
            expect(
                (
                    await h
                        .control(peer)
                        .stub.getTimeoutBuildObservation()
                        .request()
                ).stored
            ).to.equal(1);
        } finally {
            await h.control(peer).stub.restoreTimeoutBuildRecording().request();
        }
    });

    it("a non-timeout dispute refused as early does not schedule a timeout retry", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const peer = h.getPeer(0);
        const tasks = await h.rpcStub.recordScheduledTasks(peer.index);
        const recorder = await h.rpcStub.recordDisputeSubmissions(peer.index, {
            failWith: {
                customError: "RaceConditionDisputeTimeoutNotMinTimestamp",
                customErrorArgs: ["2", "1"],
                at: "send",
                times: 1
            }
        });
        try {
            await h.execOnHost(peer, async (sm) => {
                await sm.membershipService.startSelfRemovalDispute(sm.forkId);
            });
            expect(await recorder.submissions()).to.have.length(1);
            const dispute = Codec.decode(
                (await recorder.submissions())[0].encodedDispute,
                Type.Dispute
            );
            expect(dispute.input.timeout.participant).to.equal(ZeroAddress);
            expect(
                (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith(
                        "timeoutParticipantAfterEarlySubmission"
                    )
                )
            ).to.have.length(0);
        } finally {
            await recorder.restore();
            await tasks.restore();
        }
    });

    describe("early chain timestamp refusal", function () {
        it("send refused once → rechecks and commits the timeout", async function () {
            await assertEarlyTimeoutRetry(TestSession.getHarness(), "send", 1);
        });

        it("receipt refused once → rolls back and commits the retry", async function () {
            await assertEarlyTimeoutRetry(TestSession.getHarness(), "wait", 1);
        });

        it("two early refusals → re-arms each time and commits", async function () {
            await assertEarlyTimeoutRetry(TestSession.getHarness(), "send", 2);
        });
    });

    describe("early refusal delay", function () {
        it("chain three seconds early → schedules the reported remaining interval", async function () {
            await assertEarlyTimeoutRetry(
                TestSession.getHarness(),
                "send",
                1,
                3
            );
        });
        it("zero reported difference → retains a one-second minimum delay", async function () {
            await assertEarlyTimeoutRetry(
                TestSession.getHarness(),
                "send",
                1,
                0
            );
        });
    });

    describe("obsolete early timeout retry", function () {
        it("verified sync replaces the fork → queued retry and later schedules do nothing", async function () {
            await assertTimeoutRetryAfterForkSwitch(TestSession.getHarness());
        });
        it("the writer block arrives before retry → no second submission", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "block"
            );
        });
        it("runtime disposed before retry → no second submission", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "disposed"
            );
        });
    });

    describe("posted block → forced only on rejection", function () {
        it("a plain check meets a valid posted block still in confirmation → no dispute, then the block is stored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const hold = await h.rpcStub.holdBlockWork(
                observer.index,
                "confirmation"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                const { leader, startHeight, forkId } =
                    await h.transition.postNextBlockOnlyOnChainWait({
                        observerIndex: observer.index
                    });
                await hold.waitUntilEntered();
                await checkTimeoutAfterDeadline(h, observer.index, {
                    forkId,
                    height: startHeight,
                    writer: leader.address,
                    isForced: false
                });
                expect(await recorder.submissions()).to.deep.equal([]);
                expect(
                    await h.control(observer).query.getTimeout(forkId).request()
                ).to.equal(null);

                await hold.release();
                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockByHeight(forkId, startHeight)
                            .request()) !== null,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await recorder.submissions()).to.deep.equal([]);
            } finally {
                await hold.release();
                await recorder.restore();
            }
        });

        it("the pipeline rejects a bad-signature block posted by the writer in turn → a forced timeout names it after the deadline", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const writer = await h
                .control(observer)
                .query.getNextToWrite()
                .request();
            const writerPeer = h.peers.find((p) => p.address === writer)!;
            await h.dispute.suppressDisputeInitiation([1, 2]);
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                await h.byzantine.postJunkCalldataOnChain(writerPeer.index, {
                    height: 2
                });
                await waitFor(
                    async () => (await recorder.submissions()).length > 0,
                    h.event.hostExecTimeoutMs()
                );
                // two requests: the rejecting hook on the event, and the
                // deadline check's hand-back rejecting the same block again
                const requests = async () =>
                    (await tasks.tasks()).filter((task) =>
                        task.taskName.startsWith(
                            "timeoutParticipantAfterPostedBlockRejected"
                        )
                    );
                await waitFor(
                    async () => (await requests()).length === 2,
                    h.event.hostExecTimeoutMs()
                );
                expect(await requests()).to.deep.equal([
                    {
                        taskName: `timeoutParticipantAfterPostedBlockRejected - fork ${forkId} - block 2 - participant ${writer}`,
                        delayMs: 0
                    },
                    {
                        taskName: `timeoutParticipantAfterPostedBlockRejected - fork ${forkId} - block 2 - participant ${writer}`,
                        delayMs: 0
                    }
                ]);
                // the second request re-validates but sends nothing: the
                // dispute marker is already set
                expect(
                    (await recorder.submissions()).filter(
                        (submission) =>
                            Codec.decode(
                                submission.encodedDispute,
                                Type.Dispute
                            ).input.timeout.isForced
                    )
                ).to.have.length(1);
                const timeout = Codec.decode(
                    (await recorder.submissions())[0].encodedDispute,
                    Type.Dispute
                ).input.timeout;
                expect(timeout.isForced).to.equal(true);
                expect(timeout.participant).to.equal(writer);
                expect(Number(timeout.blockHeight)).to.equal(2);
            } finally {
                await recorder.restore();
                await tasks.restore();
            }
        });

        it("a bad-signature block posted out of turn → the requested forced check never forces", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const writer = await h
                .control(observer)
                .query.getNextToWrite()
                .request();
            const outOfTurn = h.peers.find(
                (p) => p.address !== writer && p.index !== observer.index
            )!;
            await h.dispute.suppressDisputeInitiation([1, 2]);
            // recorded, not run: the direct check below is the only one
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index, {
                suppressPrefix: "timeoutParticipant"
            });
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                await h.byzantine.postJunkCalldataOnChain(outOfTurn.index, {
                    height: 2
                });
                await waitFor(
                    async () =>
                        (await tasks.tasks()).some(
                            (task) =>
                                task.taskName ===
                                `timeoutParticipantAfterPostedBlockRejected - fork ${forkId} - block 2 - participant ${outOfTurn.address}`
                        ),
                    h.event.protocolEventTimeoutMs()
                );
                await checkTimeoutAfterDeadline(h, observer.index, {
                    forkId,
                    height: 2,
                    writer: outOfTurn.address,
                    isForced: true
                });
                // the real writer's plain check, armed before the recorder, may still time it out
                expect(
                    (await recorder.submissions()).map(
                        (submission) =>
                            Codec.decode(
                                submission.encodedDispute,
                                Type.Dispute
                            ).input.timeout.participant
                    )
                ).to.not.include(outOfTurn.address);
                expect(
                    (
                        await h
                            .control(observer)
                            .query.getTimeout(forkId)
                            .request()
                    )?.participant
                ).to.not.equal(outOfTurn.address);
            } finally {
                await recorder.restore();
                await tasks.restore();
            }
        });

        it("a forced check for a height whose previous block is not stored → returns without disputing or rescheduling", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const writer = await h
                .control(observer)
                .query.getNextToWrite()
                .request();
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index, {
                suppressPrefix: "timeoutParticipant"
            });
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                // height 4 while 2 is next: nothing is stored below it
                await h.execOnHost(
                    observer,
                    (sm, args) =>
                        sm.participantTimeoutService["tryTimeoutParticipant"](
                            args.forkId,
                            4,
                            args.writer,
                            true
                        ),
                    { forkId, writer }
                );
                expect(await recorder.submissions()).to.deep.equal([]);
                expect(
                    (await tasks.tasks()).filter((task) =>
                        task.taskName.includes("block 4")
                    )
                ).to.deep.equal([]);
            } finally {
                await recorder.restore();
                await tasks.restore();
            }
        });

        it("a bad-signature block posted into a dispute window opened before the deadline → no forced timeout", async function () {
            const h = TestSession.getHarness();
            const staged = await stageWindowBeforeTimeoutDeadline(h);
            try {
                await h.byzantine.postJunkCalldataOnChain(staged.writer.index, {
                    height: staged.height
                });
                await waitFor(
                    async () =>
                        (await h
                            .control(staged.observer)
                            .query.getBlockCalldataTimestamp(
                                staged.forkId,
                                staged.height,
                                staged.writer.address
                            )
                            .request()) !== null,
                    h.event.protocolEventTimeoutMs()
                );
                await checkTimeoutAfterDeadline(h, staged.observer.index, {
                    forkId: staged.forkId,
                    height: staged.height,
                    writer: staged.writer.address,
                    isForced: true
                });
                expect(await staged.recorder.submissions()).to.deep.equal([]);
            } finally {
                await staged.restore();
            }
        });

        it("a dispute window opened before the deadline and nothing posted → no plain timeout", async function () {
            const h = TestSession.getHarness();
            const staged = await stageWindowBeforeTimeoutDeadline(h);
            try {
                await checkTimeoutAfterDeadline(h, staged.observer.index, {
                    forkId: staged.forkId,
                    height: staged.height,
                    writer: staged.writer.address,
                    isForced: false
                });
                expect(await staged.recorder.submissions()).to.deep.equal([]);
            } finally {
                await staged.restore();
            }
        });
    });

    describe("scheduleCheck", function () {
        it("composes the task label from the reason, fork, height and participant", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);
            const target = h.getPeer(1).address;

            // four call sites build this label; recording it pins all of them
            const recorder = await h.rpcStub.recordScheduledTasks(
                observer.index,
                { suppressPrefix: "participantTimeout(" }
            );

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    sm.participantTimeoutService.scheduleCheck(
                        args.forkId,
                        4242,
                        args.target,
                        1234,
                        "participantTimeout(onSuccess)"
                    );
                    return true;
                },
                { forkId, target }
            );

            const scheduled = (await recorder.tasks()).filter((task) =>
                task.taskName.includes("block 4242")
            );

            expect(scheduled).to.have.length(1);
            expect(scheduled[0].taskName).to.equal(
                `participantTimeout(onSuccess) - fork ${forkId} - block 4242 - participant ${target}`
            );
            expect(scheduled[0].delayMs).to.equal(1234);
        });
    });

    describe("tryTimeoutParticipant → a real timeout", function () {
        it("next writer stays silent past its deadline → stored timeout names it, not forced", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2); // heights 0..1, peer 2 is next

            await h.assert.dispute.initiatedWait({ peersIndices: [0, 1] });

            const timeout = await h
                .control(h.getPeer(0))
                .query.getTimeout(h.activeForkId!)
                .request();

            expect(timeout, "a timeout was stored").to.not.be.null;
            expect(timeout!.participant).to.equal(h.getPeer(2).address);
            // nothing was posted on-chain for that height, so it is a plain
            // timeout rather than a forced one
            expect(timeout!.isForced).to.equal(false);
        });
    });

    describe("tryTimeoutParticipant → guards", function () {
        it("the target is me → returns without disputing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    await sm.participantTimeoutService["tryTimeoutParticipant"](
                        args.forkId,
                        args.height,
                        sm.signerAddress
                    );
                    return true;
                },
                { forkId: h.activeForkId!, height: 2 }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
        });

        it("I am not a participant → returns without disputing", async function () {
            const h = TestSession.getHarness();
            await h.scenario.spectatorJoinedAndSynced();
            const spectator = h.getPeer(3);
            expect(
                await h.control(spectator).query.getStatus().request()
            ).to.equal(Status.SYNCED);

            const recorder = await h.rpcStub.recordDisputeSubmissions(
                spectator.index
            );

            await h.execOnHost(
                spectator,
                async (sm, args) => {
                    await sm.participantTimeoutService["tryTimeoutParticipant"](
                        args.forkId,
                        args.height,
                        args.target
                    );
                    return true;
                },
                {
                    forkId: h.activeForkId!,
                    height: 99,
                    target: h.getPeer(1).address
                }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
        });

        it("a block already exists at that height → returns without disputing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // heights 0..1 stored
            const observer = h.getPeer(0);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            const authorOfBlockOne = await h
                .control(observer)
                .query.getBlockByHeight(h.activeForkId!, 1)
                .request();

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    await sm.participantTimeoutService["tryTimeoutParticipant"](
                        args.forkId,
                        1,
                        args.target
                    );
                    return true;
                },
                {
                    forkId: h.activeForkId!,
                    target: authorOfBlockOne!.author
                }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
        });

        it("deadline has not passed yet → reschedules instead of disputing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                // a long window so the deadline is provably still open when the
                // check runs
                timeConfig: {
                    p2pTime: 10,
                    agreementTime: 10,
                    chainFallbackTime: 30,
                    evidenceTime: 6
                }
            });
            const observer = h.getPeer(0);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            const scheduled = await h.rpcStub.recordScheduledTasks(
                observer.index,
                { suppressPrefix: "timeoutParticipantDelayed" }
            );

            const nextWriter = await h.query.getNextPeerToWrite();

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    await sm.participantTimeoutService["tryTimeoutParticipant"](
                        args.forkId,
                        args.height,
                        args.target
                    );
                    return true;
                },
                {
                    forkId: h.activeForkId!,
                    height: 2,
                    target: nextWriter.address
                }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
            // the discriminating half: the open-deadline branch RESCHEDULES -
            // exactly one deferred re-check with a positive remaining window
            const rescheduled = (await scheduled.tasks()).filter((t) =>
                t.taskName.startsWith("timeoutParticipantDelayed")
            );
            await scheduled.restore();
            expect(rescheduled.length).to.equal(1);
            expect(rescheduled[0].delayMs).to.be.greaterThan(0);
        });
    });

    describe("previous-producer mismatch refusal", function () {
        it("M1 send mismatch false to true rechecks and commits", async function () {
            const h = TestSession.getHarness();
            await assertEarlyTimeoutRetry(h, "send", 1, 1, {
                customError: MISMATCH_TIMEOUT_ERROR,
                mismatchDirection: {
                    expectedPosted: false,
                    foundPosted: true
                }
            });
        });

        it("M1 send mismatch true to false rechecks and commits", async function () {
            const h = TestSession.getHarness();
            await assertEarlyTimeoutRetry(h, "send", 1, 1, {
                customError: MISMATCH_TIMEOUT_ERROR,
                mismatchDirection: {
                    expectedPosted: true,
                    foundPosted: false
                }
            });
        });

        it("M2 receipt mismatch rolls back and commits the retry", async function () {
            const h = TestSession.getHarness();
            await assertEarlyTimeoutRetry(h, "wait", 1, 1, {
                customError: MISMATCH_TIMEOUT_ERROR,
                mismatchDirection: {
                    expectedPosted: false,
                    foundPosted: true
                }
            });
        });

        it("M3 consecutive mismatches each rearm and then commit", async function () {
            await assertConsecutiveMismatchRetry(TestSession.getHarness());
        });
    });

    describe("obsolete mismatch retry", function () {
        it("M4 verified fork replacement obsoletes mismatch retry", async function () {
            await assertTimeoutRetryAfterForkSwitch(
                TestSession.getHarness(),
                MISMATCH_TIMEOUT_RETRY_REASON
            );
        });

        it("M4 writer block obsoletes mismatch retry", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "block",
                {
                    customError: MISMATCH_TIMEOUT_ERROR,
                    customErrorArgs: mismatchRefusalArgs(
                        ZeroAddress,
                        0,
                        false,
                        true
                    )
                }
            );
        });

        it("M4 disposal obsoletes mismatch retry", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "disposed",
                {
                    customError: MISMATCH_TIMEOUT_ERROR,
                    customErrorArgs: mismatchRefusalArgs(
                        ZeroAddress,
                        0,
                        false,
                        true
                    )
                }
            );
        });

        it("M4 writer block during retry construction prevents timeout store", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState();
            const observer = h.getPeer(2);
            const forkId = h.activeForkId!;
            // Suppress dispute initiation on both non-observer peers while
            // staging the race; either may author the writer block, and
            // neither may dispute while it is in flight.
            await h.dispute.suppressDisputeInitiation([
                h.getPeer(0).index,
                h.getPeer(1).index
            ]);
            const held = await h.rpcStub.holdScheduledTasks(
                observer.index,
                MISMATCH_TIMEOUT_RETRY_REASON
            );
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index,
                {
                    forward: true,
                    failWith: {
                        customError: MISMATCH_TIMEOUT_ERROR,
                        customErrorArgs: mismatchRefusalArgs(
                            h.getPeer(0).address,
                            0,
                            false,
                            true
                        ),
                        at: "send",
                        times: 1
                    }
                }
            );
            // Constructor-scoped, one-shot hold installed on the real service
            // through host calls: wraps the real createTimeOutDispute entry,
            // and only while that invocation reads its height-1 commitment
            // parks after the real result and before returning it. Earlier
            // tryTimeoutParticipant reads and independent pipeline reads run
            // normally. Wrapper state lives on the real service; the original
            // constructor, commitment read and store are never bypassed.
            const installBuildHold = () =>
                h.execOnHost(observer, (sm) => {
                    const service = sm.participantTimeoutService;
                    const contract =
                        sm.diamondStateMachine.localDiamondContract;
                    const timeoutStorage = sm.storage.timeout;
                    if (Reflect.get(service, "__m4TimeoutBuildHold"))
                        return false;
                    const originalBuild = service["createTimeOutDispute"];
                    const originalCommitment =
                        contract.getBlockCallDataCommitment;
                    const store =
                        timeoutStorage.storeTimeout.bind(timeoutStorage);
                    let releaseGate: () => void = () => undefined;
                    const gate = new Promise<void>((resolve) => {
                        releaseGate = resolve;
                    });
                    const state = {
                        armed: true,
                        entered: 0,
                        stored: 0,
                        completed: 0,
                        release: () => releaseGate()
                    };
                    Reflect.set(
                        service,
                        "createTimeOutDispute",
                        async (...buildArgs: unknown[]) => {
                            const current = Reflect.get(
                                service,
                                "__m4TimeoutBuildHold"
                            ) as typeof state | undefined;
                            if (!current || !current.armed)
                                return Reflect.apply(
                                    originalBuild,
                                    service,
                                    buildArgs
                                );
                            current.armed = false;
                            const innerCommitment =
                                contract.getBlockCallDataCommitment;
                            let parked = false;
                            Reflect.set(
                                contract,
                                "getBlockCallDataCommitment",
                                async (...commitmentArgs: unknown[]) => {
                                    const result = await Reflect.apply(
                                        innerCommitment,
                                        contract,
                                        commitmentArgs
                                    );
                                    const live = Reflect.get(
                                        service,
                                        "__m4TimeoutBuildHold"
                                    ) as typeof state | undefined;
                                    if (live && !parked) {
                                        parked = true;
                                        live.entered += 1;
                                        await gate;
                                    }
                                    return result;
                                }
                            );
                            try {
                                return await Reflect.apply(
                                    originalBuild,
                                    service,
                                    buildArgs
                                );
                            } finally {
                                const live = Reflect.get(
                                    service,
                                    "__m4TimeoutBuildHold"
                                ) as typeof state | undefined;
                                if (live) live.completed += 1;
                                Reflect.set(
                                    contract,
                                    "getBlockCallDataCommitment",
                                    innerCommitment
                                );
                            }
                        }
                    );
                    timeoutStorage.storeTimeout = (...args) => {
                        state.stored += 1;
                        return store(...args);
                    };
                    Reflect.set(service, "__m4TimeoutBuildHold", state);
                    Reflect.set(service, "__m4TimeoutBuildHoldRestore", () => {
                        state.release();
                        Reflect.set(
                            service,
                            "createTimeOutDispute",
                            originalBuild
                        );
                        Reflect.set(
                            contract,
                            "getBlockCallDataCommitment",
                            originalCommitment
                        );
                        timeoutStorage.storeTimeout = store;
                        Reflect.deleteProperty(service, "__m4TimeoutBuildHold");
                        Reflect.deleteProperty(
                            service,
                            "__m4TimeoutBuildHoldRestore"
                        );
                    });
                    return true;
                });
            const readBuildHold = () =>
                h.execOnHost(observer, (sm) => {
                    const state = Reflect.get(
                        sm.participantTimeoutService,
                        "__m4TimeoutBuildHold"
                    ) as
                        | {
                              entered: number;
                              stored: number;
                              completed: number;
                          }
                        | undefined;
                    return {
                        entered: state?.entered ?? 0,
                        stored: state?.stored ?? 0,
                        completed: state?.completed ?? 0
                    };
                });
            const releaseBuildHold = () =>
                h.execOnHost(observer, (sm) => {
                    const state = Reflect.get(
                        sm.participantTimeoutService,
                        "__m4TimeoutBuildHold"
                    ) as { release: () => void } | undefined;
                    state?.release();
                    return true;
                });
            const restoreBuildHold = () =>
                h.execOnHost(observer, (sm) => {
                    const restore = Reflect.get(
                        sm.participantTimeoutService,
                        "__m4TimeoutBuildHoldRestore"
                    );
                    if (typeof restore === "function") restore();
                    return true;
                });
            const didObserverDispute = () =>
                h.execOnHost(
                    observer,
                    (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
                    { forkId }
                );
            const stage = await h.execOnHost(
                observer,
                async (sm, args) => ({
                    height: sm.storage.blocks.getNextBlockHeight(args.forkId),
                    writer: await sm.diamondStateMachine.getNextToWrite()
                }),
                { forkId }
            );
            const targetHeight = stage.height;
            // Drive the initial check manually under a scoped zero deadline:
            // the natural deadline waits ~8s, but a writer block authored
            // more than ~5s after the previous block fails subjective time
            // validation, so the natural path can never deliver an acceptable
            // block during construction. The check itself is the real one the
            // scheduler calls (as in the committed consecutive-mismatch
            // round); only its deadline is collapsed. The retry under test
            // still travels the real held scheduler path.
            const shrinkTimeConfig = () =>
                h.execOnHost(observer, (sm) => {
                    if (Reflect.get(sm, "__m4TimeConfig")) return false;
                    const config = sm.timeConfig;
                    Reflect.set(sm, "__m4TimeConfig", {
                        p2pTime: config.p2pTime,
                        agreementTime: config.agreementTime,
                        chainFallbackTime: config.chainFallbackTime
                    });
                    config.p2pTime = 0;
                    config.agreementTime = 0;
                    config.chainFallbackTime = 0;
                    return true;
                });
            const restoreTimeConfig = () =>
                h.execOnHost(observer, (sm) => {
                    const original = Reflect.get(sm, "__m4TimeConfig") as
                        | {
                              p2pTime: number;
                              agreementTime: number;
                              chainFallbackTime: number;
                          }
                        | undefined;
                    if (original) {
                        const config = sm.timeConfig;
                        config.p2pTime = original.p2pTime;
                        config.agreementTime = original.agreementTime;
                        config.chainFallbackTime = original.chainFallbackTime;
                        Reflect.deleteProperty(sm, "__m4TimeConfig");
                    }
                    return true;
                });
            const runInitialTimeoutCheck = () =>
                h.execOnHost(
                    observer,
                    async (sm, args) => {
                        await sm.participantTimeoutService[
                            "tryTimeoutParticipant"
                        ](args.forkId, args.height, args.writer);
                        return true;
                    },
                    { forkId, height: targetHeight, writer: stage.writer },
                    { timeoutMs: h.event.hostExecTimeoutMs() }
                );
            try {
                expect(await shrinkTimeConfig()).to.equal(true);
                await runInitialTimeoutCheck();
                await waitFor(
                    async () => (await held.heldCount()) === 1,
                    h.event.hostExecTimeoutMs()
                );
                expect(await recorder.submissions()).to.have.length(1);
                expect(await didObserverDispute()).to.equal(false);
                const retryTasks = (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith(MISMATCH_TIMEOUT_RETRY_REASON)
                );
                expect(retryTasks).to.have.length(1);
                expect(retryTasks[0].delayMs).to.equal(
                    TIMEOUT_RECHECK_DELAY_MS
                );
                expect(await installBuildHold()).to.equal(true);
                await held.release(true);
                await waitFor(
                    async () => (await readBuildHold()).entered >= 1,
                    h.event.hostExecTimeoutMs()
                );
                // The retry is parked past all deadline logic: restore the
                // real time config before authoring so the writer block faces
                // the committed validation window.
                expect(await restoreTimeConfig()).to.equal(true);
                await h.transition.advanceState();
                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockByHeight(forkId, targetHeight)
                            .request()) !== null,
                    h.event.hostExecTimeoutMs()
                );
                expect(await didObserverDispute()).to.equal(false);
                await releaseBuildHold();
                await waitFor(
                    async () => (await readBuildHold()).completed >= 1,
                    h.event.hostExecTimeoutMs()
                );
                expect((await readBuildHold()).stored).to.equal(0);
                expect(await recorder.submissions()).to.have.length(1);
                expect(await didObserverDispute()).to.equal(false);
            } finally {
                await restoreTimeConfig();
                await restoreBuildHold();
                await held.release(false);
                await recorder.restore();
                await tasks.restore();
            }
        });
    });

    describe("shared retry delay", function () {
        it("M5 shared validation retry delay remains one second", async function () {
            expect(TIMEOUT_RECHECK_DELAY_MS).to.equal(1000);
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index);
            try {
                await h.execOnHost(
                    observer,
                    (sm, args) => {
                        sm.participantTimeoutService[
                            "scheduleTimeoutParticipantRetry"
                        ](args.forkId, 0, args.participant, "m5-probe", false);
                        return true;
                    },
                    { forkId, participant: h.getPeer(1).address }
                );
                const retries = (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith(
                        "timeoutParticipantAfterOnChainValidation"
                    )
                );
                expect(retries).to.have.length(1);
                expect(retries[0].delayMs).to.equal(1000);
                expect(retries[0].delayMs).to.equal(TIMEOUT_RECHECK_DELAY_MS);
            } finally {
                await tasks.restore();
            }
        });

        it("M5 timestamp delay retains reported interval", async function () {
            await assertEarlyTimeoutRetry(
                TestSession.getHarness(),
                "send",
                1,
                3
            );
        });
    });
});
