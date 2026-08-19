import { expect } from "chai";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

// the guard cases call tryTimeoutParticipant directly with the dispute
// submission recorder installed, so a guard that failed to hold would show up
// as a recorded submission. the real timeout at the top is the positive
// control: the same code path does submit when the deadline really passed.

describe("Unit: ParticipantTimeoutService", function () {
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
});
