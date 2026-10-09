import {
    CHAIN_READ_FAILED_RECHECK_REASON,
    EARLY_TIMEOUT_RECHECK_REASON
} from "@/stateManager/chainFallback/ParticipantTimeoutService";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import {
    assertEarlyTimeoutRetry,
    assertMismatchRetryAfterForkSwitch,
    assertTimeoutRetryAfterForkSwitch,
    assertObsoleteEarlyTimeoutRetry,
    assertConsecutiveMismatchRetry,
    assertSkippedHeightNotTimedOut,
    checkTimeoutAfterDeadline,
    skipHeightOnObserver,
    stageWindowBeforeTimeoutDeadline
} from "@test/fixtures/EarlyTimeoutRetryStaging";
import { assertTimeoutCheckWaitsForSyncInstall } from "@test/fixtures/PinnedSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { protocolEventTimeoutMs } from "@test/harness/core/testTimeConfig";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

// the guard cases call tryTimeoutParticipant directly with the dispute
// submission recorder installed, so a guard that failed to hold would show up
// as a recorded submission. the real timeout at the top is the positive
// control: the same code path does submit when the deadline really passed.

// short windows, so the staged parent post lands inside one test
const RECHECK_TIME_CONFIG = {
    p2pTime: 2,
    agreementTime: 8,
    chainFallbackTime: 10,
    evidenceTime: 20
};

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

    it("a later state installed during timeout construction prevents the late timeout store", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);
        const peer = h.getPeer(0);
        const forkId = h.activeForkId!;
        for (const index of [1, 2]) await h.rpcStub.suppressTimeoutCheck(index);
        const tasks = await h.rpcStub.recordScheduledTasks(peer.index, {
            suppressPrefix: "participantTimeout("
        });
        const writer = await h.control(peer).query.getNextToWrite().request();
        await h.control(peer).stub.holdTimeoutBuild().request();
        const construct = h
            .control(peer)
            .stub.startTimeoutConstruction(writer, 2)
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
            await skipHeightOnObserver(h, peer.index, forkId, 2);
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
            expect(
                await h.control(peer).query.getTimeout(forkId).request()
            ).to.equal(null);
        } finally {
            await h.control(peer).stub.restoreTimeoutBuildRecording().request();
            await tasks.restore();
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
                    task.taskName.startsWith(EARLY_TIMEOUT_RECHECK_REASON)
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

        it("a stale stored timeout at a passed height → the next height's timeout replaces it and is disputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // heights 0..1
            const forkId = h.activeForkId!;
            const tasks = await Promise.all(
                [0, 1, 2].map((index) =>
                    h.rpcStub.recordScheduledTasks(index, {
                        suppressPrefix: "participantTimeout("
                    })
                )
            );
            await h.transition.advanceState(); // height 2
            const writer = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            const observer = [0, 1, 2]
                .map((index) => h.getPeer(index))
                .find((peer) => peer.address !== writer)!;
            await waitFor(
                async () =>
                    (await h.execOnHost(
                        observer,
                        (sm, args) =>
                            sm.storage.blocks.getNextBlockHeight(args.forkId),
                        { forkId }
                    )) === 3
            );
            const passed = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 2)
                .request();
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                // a timeout for height 2 left stored after its block arrived
                await h.execOnHost(
                    observer,
                    (sm, args) =>
                        sm.storage.timeout.storeTimeout(args.forkId, {
                            participant: args.author,
                            blockHeight: 2n,
                            minTimeStamp: 0n,
                            isForced: false,
                            previousBlockProducer: args.zero,
                            previousBlockProducerPostedCalldata: false,
                            participantSignatureOnPreviousBlock: "0x"
                        }),
                    { forkId, author: passed!.author, zero: ZeroAddress }
                );

                await checkTimeoutAfterDeadline(h, observer.index, {
                    forkId,
                    height: 3,
                    writer,
                    isForced: false
                });

                const submissions = await recorder.submissions();
                expect(submissions).to.have.length(1);
                const { timeout } = Codec.decode(
                    submissions[0].encodedDispute,
                    Type.Dispute
                ).input;
                expect(timeout.participant).to.equal(writer);
                expect(Number(timeout.blockHeight)).to.equal(3);
                expect(
                    await h.execOnHost(
                        observer,
                        (sm, args) => {
                            const t = sm.storage.timeout.getTimeout(
                                args.forkId
                            );
                            return [t?.participant, Number(t?.blockHeight)];
                        },
                        { forkId }
                    )
                ).to.deep.equal([writer, 3]);
            } finally {
                await recorder.restore();
                for (const task of tasks) await task.restore();
            }
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

        it("an installed later state skipped that height → no stored timeout, no dispute", async function () {
            await assertSkippedHeightNotTimedOut(
                TestSession.getHarness(),
                false
            );
        });

        it("a forced check for a height an installed later state skipped → no stored timeout, no dispute", async function () {
            await assertSkippedHeightNotTimedOut(
                TestSession.getHarness(),
                true
            );
        });

        it("a check fired while a sync install is held waits for it → the installed fork leaves no stored timeout, no dispute", async function () {
            await assertTimeoutCheckWaitsForSyncInstall(
                TestSession.getHarness()
            );
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
                expectedPosted: false,
                foundPosted: true
            });
        });

        it("M1 a refusal reporting the true-to-false direction re-arms the same way", async function () {
            const h = TestSession.getHarness();
            // the handler must not branch on the refusal's direction arguments
            await assertEarlyTimeoutRetry(h, "send", 1, 1, {
                expectedPosted: true,
                foundPosted: false
            });
        });

        it("M1 a predecessor posted only in the local view → the claim carries the chain's answer and commits", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            // peer 0 authors height 0; observer 2 will time out writer 1
            await h.transition.advanceState();
            const observer = h.getPeer(2);
            const forkId = h.activeForkId!;
            await h.dispute.suppressDisputeInitiation([h.getPeer(0).index]);
            // The observer alone believes height 0 was posted (e.g. a reorg
            // dropped the post); the chain holds no commitment for it.
            await h.execOnHost(
                observer,
                (sm, args) => {
                    const block = sm.storage.blocks.getBlock(args.forkId, 0)!;
                    return sm.storage.blocks.setOnChainTimestamp(
                        args.forkId,
                        0,
                        block.timestamp + 1
                    );
                },
                { forkId }
            );
            const uploads = await h.rpcStub.recordDisputeSubmissions(
                observer.index,
                { forward: true }
            );
            try {
                await h.assert.dispute.committedWait({
                    peersIndices: [observer.index],
                    expectedCount: 1,
                    mode: "atLeast"
                });
                const [first] = await uploads.submissions();
                expect(first.revert).to.equal(null);
                expect(
                    Codec.decode(first.encodedDispute, Type.Dispute).input
                        .timeout.previousBlockProducerPostedCalldata
                ).to.equal(false);
            } finally {
                await uploads.restore();
            }
        });

        it("M2 receipt mismatch rolls back and commits the retry", async function () {
            const h = TestSession.getHarness();
            await assertEarlyTimeoutRetry(h, "wait", 1, 1, {
                expectedPosted: false,
                foundPosted: true
            });
        });

        it("M3 consecutive mismatches each rearm and then commit", async function () {
            await assertConsecutiveMismatchRetry(TestSession.getHarness());
        });
    });

    describe("obsolete mismatch retry", function () {
        it("M4 an injected mismatch refusal before a verified fork replacement leaves its re-arm nothing to do", async function () {
            await assertMismatchRetryAfterForkSwitch(TestSession.getHarness());
        });

        it("M4 writer block obsoletes mismatch retry", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "block",
                "mismatch"
            );
        });

        it("M4 disposal obsoletes mismatch retry", async function () {
            await assertObsoleteEarlyTimeoutRetry(
                TestSession.getHarness(),
                "disposed",
                "mismatch"
            );
        });
    });

    describe("predecessor commitment read failure", function () {
        it("a failed predecessor commitment read re-arms the check and the timeout still commits", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            // peer 0 authors height 0; observer 2 will time out writer 1
            await h.transition.advanceState();
            const observer = h.getPeer(2);
            await h.dispute.suppressDisputeInitiation([h.getPeer(0).index]);
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index);
            const uploads = await h.rpcStub.recordDisputeSubmissions(
                observer.index,
                { forward: true }
            );
            await h
                .control(observer)
                .stub.stubFailChainReads(
                    "getBlockCallDataCommitment",
                    Number.MAX_SAFE_INTEGER
                )
                .request();
            try {
                await waitFor(
                    async () =>
                        (await tasks.tasks()).some((task) =>
                            task.taskName.startsWith(
                                CHAIN_READ_FAILED_RECHECK_REASON
                            )
                        ),
                    h.event.hostExecTimeoutMs()
                );
                expect(await uploads.submissions()).to.deep.equal([]);
                await h
                    .control(observer)
                    .stub.restoreChainReadFailures()
                    .request();
                await h.assert.dispute.committedWait({
                    peersIndices: [observer.index],
                    expectedCount: 1,
                    mode: "atLeast"
                });
            } finally {
                await h
                    .control(observer)
                    .stub.restoreChainReadFailures()
                    .request();
                await uploads.restore();
                await tasks.restore();
            }
        });
    });

    describe("shared retry delay", function () {
        it("M5 a check waiting on the predecessor's on-chain validation re-arms after one second", async function () {
            const h = TestSession.getHarness();
            // the parent is posted on chain but its event is held from the
            // observer, so the check must schedule its recovered validation
            const { observer, author, previous, forkId } =
                await h.scenario.previousBlockUnsignedByNextWriter({
                    timeConfig: RECHECK_TIME_CONFIG
                });
            const height = previous.height + 1;
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index);
            const validationRetries = async () =>
                (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith(
                        "timeoutParticipantAfterOnChainValidation - previousOnChainBlockValidation"
                    )
                );
            try {
                await h.execOnHost(
                    observer,
                    (sm, args) => {
                        sm.participantTimeoutService.scheduleCheck(
                            args.forkId,
                            args.height,
                            args.writer,
                            0,
                            "m5Probe"
                        );
                        return true;
                    },
                    { forkId, height, writer: author.address }
                );
                // an early check first waits out the writer's deadline (the
                // protocol budget for this time config covers it)
                await waitFor(
                    async () => (await validationRetries()).length > 0,
                    protocolEventTimeoutMs(RECHECK_TIME_CONFIG)
                );
                expect((await validationRetries())[0].delayMs).to.equal(1000);
            } finally {
                await tasks.restore();
            }
        });
    });
});
