import { expect } from "chai";
import { ForkId } from "@/types/types";
import { Status } from "@/types";
import { hash as randomHash } from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("Unit: ReductionExecutor", function () {
    // a reduce whose inbound run this peer cannot walk yields no reduce data.
    // that outcome must reschedule, never reach ReductionManager.failCompletion
    // (which answers with abort() and strands the peer for good)
    describe("reduce data unavailable", function () {
        /**
         * A committed settled-path dispute whose reduce moves the inbound head
         * past `laggingIndex`'s store. Its handler is held, so nothing - the
         * on-demand recovery included - can close the gap until release.
         */
        const stageDisputeOverHeldInboundGap = async (
            h: ReturnType<typeof TestSession.getHarness>,
            laggingIndex: number
        ) => {
            await h.setup(3, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 8,
                    chainFallbackTime: 4,
                    evidenceTime: 4
                }
            });
            await h.lifecycle.openChannel();
            const forkId = h.activeForkId!;
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();

            const held = await h.rpcStub.holdInboundMessageEvents(laggingIndex);
            const observers = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== laggingIndex);
            // a top-up of an existing participant keeps the head
            // final-by-everyone -> the settled path posts no auditing data, so
            // nothing back-fills the block this peer never received
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(observers[0]).address,
                observePeerIndices: observers
            });

            h.event.resetEventSpies();
            h.contextApi.captureOriginalFork();

            const offenderIndex = (await h.query.getNextPeerToWrite()).index;
            const disputerIndex = observers.find(
                (index) => index !== offenderIndex
            )!;
            await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [disputerIndex],
                expectedCount: 1,
                initiatedWithAuditingData: false
            });
            return { forkId, held, disputerIndex };
        };

        it("no reduce data → the attempt reschedules, the peer keeps participating, a later attempt completes", async function () {
            const h = TestSession.getHarness();
            const laggingIndex = 2;
            const { forkId, held } = await stageDisputeOverHeldInboundGap(
                h,
                laggingIndex
            );
            const scheduled =
                await h.rpcStub.recordScheduledTasks(laggingIndex);

            // let the kill period lapse - before that the attempt returns at
            // the gate and never reaches the reduce computation
            await waitFor(
                async () =>
                    h.execOnHost(
                        h.getPeer(laggingIndex),
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
            const outcome = await h.execOnHost(
                h.getPeer(laggingIndex),
                async (sm, args) => {
                    let threw = "";
                    try {
                        await sm.reductionManager[
                            "reductionExecutor"
                        ].tryReduce(args.forkId);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    return { threw, forkIdAfter: String(sm.forkId) };
                },
                { forkId },
                {
                    timeoutMs:
                        h.event.protocolEventTimeoutMs({
                            withFirstBlockGrace: true
                        }) * 2
                }
            );

            // the regression: this used to throw out of the executor, and
            // ReductionManager answered the throw with abort()
            expect(outcome.threw).to.equal("");
            expect(outcome.forkIdAfter).to.equal(forkId);
            expect(
                (await scheduled.tasks()).map((task) => task.taskName)
            ).to.include(`reduction-${forkId}`);
            expect(
                await h
                    .control(h.getPeer(laggingIndex))
                    .query.getStatus()
                    .request(),
                "a deferred reduction must not evict the peer"
            ).to.equal(Status.PARTICIPATING);
            expect(
                await h
                    .control(h.getPeer(laggingIndex))
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([]);
            await scheduled.restore();

            // the missing log lands -> the rescheduled attempt has the run it
            // needs and the fork finally moves
            await held.release();
            await h.assert.sync.forkChangedWait({
                originalForkId: forkId,
                honestPeerIndices: [laggingIndex]
            });
        });

        it("someone else's reduction while the run is unavailable → not challenged, no throw", async function () {
            const h = TestSession.getHarness();
            const laggingIndex = 2;
            const { held, disputerIndex } =
                await stageDisputeOverHeldInboundGap(h, laggingIndex);

            // a reduced fork id that matches nothing locally: with reduce data
            // the peer would challenge it, without reduce data it must not
            const claimedReducedForkId = randomHash() as ForkId;
            const lagging = await h
                .control(h.getPeer(laggingIndex))
                .stub.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();

            expect(lagging.threw).to.equal(null);
            // true = do not challenge, and follow the chain instead
            expect(lagging.isValid).to.equal(true);
            expect(lagging.challengeCalls).to.equal(0);

            // control: a peer that CAN rebuild the run challenges the same
            // claim, so the probe really does observe challenges
            const healthy = await h
                .control(h.getPeer(disputerIndex))
                .stub.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();
            expect(healthy.isValid).to.equal(false);
            expect(healthy.challengeCalls).to.equal(1);

            await held.release({ replay: false });
        });
    });

    // a window whose disputes are on-chain but unreadable locally must defer
    // the same way, not be mistaken for an empty window (which would answer it
    // with a fresh local dispute) and not reach failCompletion -> abort()
    describe("dispute window unavailable", function () {
        const observerIndex = 0;
        const maliciousPeerIndex = 2;

        /** Wait out the kill period - before it the attempt exits at the gate. */
        const waitForKillPeriod = (
            h: ReturnType<typeof TestSession.getHarness>,
            forkId: ForkId
        ) =>
            waitFor(
                async () =>
                    h.execOnHost(
                        h.getPeer(observerIndex),
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

        /** Drive the executor directly - a deferred attempt never settles. */
        const tryReduceByHand = (
            h: ReturnType<typeof TestSession.getHarness>,
            forkId: ForkId
        ) =>
            h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    let threw = "";
                    try {
                        await sm.reductionManager[
                            "reductionExecutor"
                        ].tryReduce(args.forkId);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    return { threw, forkIdAfter: String(sm.forkId) };
                },
                { forkId },
                {
                    timeoutMs:
                        h.event.protocolEventTimeoutMs({
                            withFirstBlockGrace: true
                        }) * 2
                }
            );

        it("unreadable dispute window → the attempt defers instead of aborting", async function () {
            const h = TestSession.getHarness();
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex
                });
            const scheduled =
                await h.rpcStub.recordScheduledTasks(observerIndex);
            await waitForKillPeriod(h, forkId);

            const commitmentsBefore = (
                await h.channelManager.getWindowCommitments(h.channelId, forkId)
            ).length;
            const blinded = await h.rpcStub.failChainLogQueries(observerIndex);
            const outcome = await tryReduceByHand(h, forkId);

            // the regression: this used to throw out of the executor, and
            // ReductionManager answered the throw with abort()
            expect(outcome.threw).to.equal("");
            expect(outcome.forkIdAfter).to.equal(forkId);
            expect(
                await h
                    .control(h.getPeer(observerIndex))
                    .query.getStatus()
                    .request(),
                "a deferred reduction must not evict the peer"
            ).to.equal(Status.PARTICIPATING);
            expect(
                (await scheduled.tasks()).map((task) => task.taskName)
            ).to.include(`reduction-${forkId}`);
            // an unreadable window must not be answered with a fresh local
            // dispute - that is the `disputes.length === 0` branch below it
            expect(
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        forkId
                    )
                ).length,
                "the on-chain window must not grow"
            ).to.equal(commitmentsBefore);
            await scheduled.restore();

            // the queries come back -> the next attempt reads the window and
            // reduces
            await blinded.restore();
            const recovered = await tryReduceByHand(h, forkId);
            expect(recovered.threw).to.equal("");
            expect(
                recovered.forkIdAfter,
                "the recovered attempt must move the fork"
            ).to.not.equal(forkId);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });

        it("a re-dispatched dispute log that fails again → failed attempt, not a fatal", async function () {
            const h = TestSession.getHarness();
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex
                });
            await waitForKillPeriod(h, forkId);

            // the queries succeed, but every re-dispatched dispute log throws
            // inside the handler - the Promise.all leg that used to reject out
            // of the recovery into abort()
            const failing =
                await h.rpcStub.failDisputeCommittedHandler(observerIndex);
            const outcome = await tryReduceByHand(h, forkId);

            expect(outcome.threw).to.equal("");
            expect(outcome.forkIdAfter).to.equal(forkId);
            expect(
                await h
                    .control(h.getPeer(observerIndex))
                    .query.getStatus()
                    .request(),
                "a failed re-dispatch must not evict the peer"
            ).to.equal(Status.PARTICIPATING);
            expect(
                await failing.handlerCalls(),
                "the recovery must really have re-dispatched the held logs"
            ).to.be.greaterThan(0);
            await failing.restore();

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });

        it("unreadable dispute window → the reduction is not challenged", async function () {
            const h = TestSession.getHarness();
            const { race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex
                });

            // a reduced fork id that matches nothing locally: with a readable
            // window the peer would challenge it, without one it must not
            const claimedReducedForkId = randomHash() as ForkId;
            const blinded = await h.rpcStub.failChainLogQueries(observerIndex);
            const probe = await h
                .control(h.getPeer(observerIndex))
                .stub.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();
            await blinded.restore();

            expect(probe.threw).to.equal(null);
            // true = do not challenge, and follow the chain instead
            expect(probe.isValid).to.equal(true);
            expect(probe.challengeCalls).to.equal(0);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });
    });

    describe("getSyncedForkDisputes", function () {
        // a dispute commitment lands on-chain before our onDisputeCommitted
        // handler stores the struct. tryReduce firing in that gap used to
        // hit AgreementManager.getForkDisputes and throw "Missing Dispute in
        // storage" - getSyncedForkDisputes now recovers via
        // EventSyncService.ensureDisputesProcessed before reading storage.
        it("committed dispute missing locally → recovers via event replay, then reduces", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2
                });

            // wait out the kill period - before it expires tryReduce
            // returns undefined at the gate and never reaches recovery
            await waitFor(
                async () =>
                    h.execOnHost(
                        h.getPeer(observerIndex),
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

            const outcome = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const missingBefore = commitments.filter(
                        (c) => !sm.storage.disputes.getDispute(c)
                    );

                    let threw = "";
                    try {
                        await sm.reductionManager.tryReduce(args.forkId);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }

                    const recoveredAll = commitments.every((c) =>
                        Boolean(sm.storage.disputes.getDispute(c))
                    );
                    // the point of the recovery: the disputes the reduction
                    // path now hands to reduce() are the WHOLE on-chain window,
                    // not the subset whose events happened to arrive
                    const reducedDisputes =
                        await sm.reductionManager.getSyncedForkDisputes(
                            args.forkId
                        );
                    return {
                        commitmentCount: commitments.length,
                        missingBeforeCount: missingBefore.length,
                        threw,
                        recoveredAll,
                        reducedDisputeCount: reducedDisputes?.length ?? null
                    };
                },
                { forkId }
            );

            // sanity: we actually staged a genuinely-missing commitment
            expect(
                outcome.commitmentCount,
                "window must hold commitments"
            ).to.be.greaterThan(0);
            expect(
                outcome.missingBeforeCount,
                "at least one commitment must be missing locally before recovery"
            ).to.be.greaterThan(0);

            expect(outcome.threw, "tryReduce must recover, not throw").to.equal(
                ""
            );
            expect(
                outcome.recoveredAll,
                "every dispute must be recovered locally"
            ).to.equal(true);
            // the substantive check: reduction runs over the COMPLETE on-chain
            // window
            expect(
                outcome.reducedDisputeCount,
                "reduction must consume every commitment in the on-chain window"
            ).to.equal(outcome.commitmentCount);

            // the manual tryReduce already completed the reduction - release
            // the held race/event entry points without replaying stale work
            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);

            await h.assert.dispute.reductionCompletedWait({
                sourceForkId: forkId,
                peerIndices: [observerIndex, 1, 3]
            });
        });
    });
});
