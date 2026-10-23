import { Status } from "@/types";
import { ForkId } from "@/types/types";
import { hash as randomHash } from "@test/factory";
import { tryReduceAfterKillPeriod } from "@test/fixtures/DeferredReductionStaging";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import {
    assertSettledAdoptionRefusal,
    type FinalLaterReduction,
    finalizeLaterReduction,
    openSuccessorDispute,
    stageHeldSuccessorAdoption
} from "@test/fixtures/SettledAdoptionStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

describe("Unit: ReductionExecutor", function () {
    // a reduce whose inbound run or head state this peer lacks yields no reduce
    // data. a non-participant aborts cleanly on it (it can resync later); a
    // participant reschedules instead
    describe("reduce data unavailable", function () {
        it("inbound run unavailable on a spectator → the attempt aborts it cleanly without a throw, and the participants still reduce", async function () {
            const h = TestSession.getHarness();
            // the reading peer is a synced spectator: it does not audit, so it
            // holds the window while the run stays unavailable. a
            // participant's audit of that window throws on the run (fatal),
            // so a participant never reaches the reduce with it missing
            const {
                forkId,
                disputerIndex,
                spectatorIndex: laggingIndex
            } = await h.scenario.stageSpectatedDisputeOverHeldInboundGap();

            const outcome = await tryReduceAfterKillPeriod(
                h,
                laggingIndex,
                forkId
            );

            expect(outcome).to.deep.equal({
                threw: "",
                forkIdAfter: forkId,
                statusAfter: Status.OPENED
            });
            await waitFor(
                () => runtimeIsClosed(h.getPeer(laggingIndex).p2pInstance),
                h.event.protocolEventTimeoutMs()
            );
            await h.assert.sync.forkChangedWait({
                originalForkId: forkId,
                honestPeerIndices: [disputerIndex]
            });
        });

        it("someone else's reduction while the run is unavailable → not challenged, no throw", async function () {
            const h = TestSession.getHarness();
            // a synced spectator, as above: a participant's audit of the
            // window throws on the unavailable run
            const {
                held,
                disputerIndex,
                spectatorIndex: laggingIndex
            } = await h.scenario.stageSpectatedDisputeOverHeldInboundGap();

            // a reduced fork id that matches nothing locally: with reduce data
            // the peer would challenge it, without reduce data it must not
            const claimedReducedForkId = randomHash() as ForkId;
            const lagging = await h
                .control(h.getPeer(laggingIndex))
                .validation.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();

            expect(lagging.threw).to.equal(null);
            // true = do not challenge, and follow the chain instead
            expect(lagging.isValid).to.equal(true);
            expect(lagging.challengeCalls).to.equal(0);

            // control: a peer that CAN rebuild the run challenges the same
            // claim, so the probe really does observe challenges
            const healthy = await h
                .control(h.getPeer(disputerIndex))
                .validation.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();
            expect(healthy.isValid).to.equal(false);
            expect(healthy.challengeCalls).to.equal(1);

            await held.release({ replay: false });
        });

        it("reduced head the spectator never received → the attempt aborts it cleanly without a throw, and the participants still reduce", async function () {
            const h = TestSession.getHarness();
            // a spectator cut off before the participants' last block: the
            // window reduces to that block, whose state it never stored
            const { forkId, spectatorIndex, disputerIndex } =
                await h.scenario.stageSpectatedDisputeAboveSpectatorHead();
            const spectator = h.getPeer(spectatorIndex);
            // premise - the window reduces to a head above everything the
            // spectator holds
            const reducedHeight = await h.query.reducedHeadHeight(
                forkId,
                spectatorIndex
            );
            const spectatorHeight = await h
                .control(spectator)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(reducedHeight).to.not.equal(null);
            expect(reducedHeight).to.be.greaterThan(Number(spectatorHeight));

            const outcome = await tryReduceAfterKillPeriod(
                h,
                spectatorIndex,
                forkId
            );

            expect(outcome).to.deep.equal({
                threw: "",
                forkIdAfter: forkId,
                statusAfter: Status.OPENED
            });
            await waitFor(
                () => runtimeIsClosed(spectator.p2pInstance),
                h.event.protocolEventTimeoutMs()
            );
            await h.assert.sync.forkChangedWait({
                originalForkId: forkId,
                honestPeerIndices: [disputerIndex]
            });
        });

        // no test: a committed participant behind the reduced head
        // reschedules after chainFallbackTime instead of aborting. no staging
        // puts a committed participant behind a window's reduced head; that
        // offline participant is the watchtower assumption's case.
        // missing input: a participant cut off before the reduced head
        it.skip("reduced head a participant never received → the attempt reschedules after chainFallbackTime, the participant keeps its status", function () {});

        it("someone else's reduction while the reduced head is not held → not challenged, no throw", async function () {
            const h = TestSession.getHarness();
            const { disputerIndex, spectatorIndex } =
                await h.scenario.stageSpectatedDisputeAboveSpectatorHead();

            // a reduced fork id that matches nothing locally: with reduce data
            // the peer would challenge it, without reduce data it must not
            const claimedReducedForkId = randomHash() as ForkId;
            const lagging = await h
                .control(h.getPeer(spectatorIndex))
                .validation.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();

            expect(lagging.threw).to.equal(null);
            // true = do not challenge, and follow the chain instead
            expect(lagging.isValid).to.equal(true);
            expect(lagging.challengeCalls).to.equal(0);

            // control: a peer that holds the head challenges the same claim
            const healthy = await h
                .control(h.getPeer(disputerIndex))
                .validation.probeDisputeReductionChallenge(claimedReducedForkId)
                .request();
            expect(healthy.isValid).to.equal(false);
            expect(healthy.challengeCalls).to.equal(1);
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
                    timeoutMs: h.event.hostExecTimeoutMs()
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
            const blinded = await h.rpcStub.hideChainLogs(observerIndex);
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

        it("a re-dispatched dispute log that fails → the attempt rejects with that failure", async function () {
            const h = TestSession.getHarness();
            const { forkId } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex
                });
            await waitForKillPeriod(h, forkId);

            // the queries succeed, but every re-dispatched dispute log throws
            // inside the handler: a local failure is fatal
            const failing =
                await h.rpcStub.failDisputeCommittedHandler(observerIndex);
            const outcome = await tryReduceByHand(h, forkId);

            expect(outcome.threw).to.equal(
                "stubbed onDisputeCommitted failure"
            );
            expect(outcome.forkIdAfter).to.equal(forkId);
            expect(
                await failing.handlerCalls(),
                "the recovery must really have re-dispatched the held logs"
            ).to.be.greaterThan(0);
            await failing.restore();

            // Keep event and timer holds until harness disposal. Restoring only
            // event handlers lets a late chain event await a deferred reduction
            // whose retry timer is still held, hanging the detached-promise drain.
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
            const blinded = await h.rpcStub.hideChainLogs(observerIndex);
            const probe = await h
                .control(h.getPeer(observerIndex))
                .validation.probeDisputeReductionChallenge(claimedReducedForkId)
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

    describe("fork adoption after the reduce", function () {
        it("the reduce lands alone and a failed adopt-only post is retried once → the chain adopts the reduced fork", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork();
            // The adoption retry is the subject; an idle successor must not
            // open another timeout dispute while that retry is pending.
            await Promise.all(
                h.peers.map((peer) =>
                    h.rpcStub.suppressTimeoutCheck(peer.index)
                )
            );
            const reducer = h.getPeer(0);
            const adoption = await h.rpcStub.failFirstAdoptionPost(
                reducer.index
            );
            // only this peer reduces; the others keep their reduction timers held
            await h.control(reducer).stub.restoreReductionTasks(true).request();

            const chainForkId = async () =>
                (await h.channelManager.getStateSnapshot(h.channelId))
                    .forkId as ForkId;
            await waitFor(
                async () =>
                    (await adoption.recorded()).filter(
                        (names) =>
                            names.length === 1 &&
                            names[0] === "updateStateSnapshotFork"
                    ).length === 2 && (await chainForkId()) !== sourceForkId,
                h.event.protocolEventTimeoutMs()
            );
            const recorded = await adoption.restore();
            const reducedForkId =
                await h.query.reducedForkOnChain(sourceForkId);

            // the reduce is its own transaction, never bundled with the adoption
            expect(recorded).to.deep.include(["reduceAndFinalize"]);
            expect(
                recorded.some(
                    (names) =>
                        names.length > 1 &&
                        names.includes("updateStateSnapshotFork")
                )
            ).to.equal(false);
            expect(await chainForkId()).to.equal(reducedForkId);
        });

        it("the reduce is mined out of gas and its resend lands → the reduced fork is adopted and nothing is reported as failed", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork();
            await Promise.all(
                h.peers.map((peer) =>
                    h.rpcStub.suppressTimeoutCheck(peer.index)
                )
            );
            const reducer = h.getPeer(0);
            const underfunded = await h.rpcStub.underfundFirstReducePost(
                reducer.index
            );
            try {
                await h
                    .control(reducer)
                    .stub.restoreReductionTasks(true)
                    .request();

                const chainForkId = async () =>
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId as ForkId;
                await waitFor(
                    async () => (await chainForkId()) !== sourceForkId,
                    h.event.protocolEventTimeoutMs()
                );
                const reducedForkId =
                    await h.query.reducedForkOnChain(sourceForkId);

                expect(await chainForkId()).to.equal(reducedForkId);
                // the first reduce is mined and fails; its resend is mined
                // and succeeds, and the adoption follows it
                expect(await underfunded.sendStatuses()).to.deep.equal([0, 1]);
                await TestSession.settleDetached();
            } finally {
                await underfunded.restore();
            }
        });

        it("the adopt-only post and its one retry both fail → no third attempt, the failure surfaces, the reduce stays recorded", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork();
            // The adoption retry is the subject; an idle successor must not
            // open another timeout dispute while that retry is pending.
            await Promise.all(
                h.peers.map((peer) =>
                    h.rpcStub.suppressTimeoutCheck(peer.index)
                )
            );
            const reducer = h.getPeer(0);
            const adoption = await h.rpcStub.failFirstAdoptionPost(
                reducer.index,
                2
            );
            await h.control(reducer).stub.restoreReductionTasks(true).request();
            // after the reduction-task restore, which resets scheduleTask
            const tasks = await h.rpcStub.recordScheduledTasks(reducer.index);

            const adoptionPosts = async () =>
                (await adoption.recorded()).filter(
                    (names) =>
                        names.length === 1 &&
                        names[0] === "updateStateSnapshotFork"
                ).length;
            try {
                await waitFor(
                    async () => (await adoptionPosts()) === 2,
                    h.event.protocolEventTimeoutMs()
                );
                const retries = (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith("adoptReducedFork-")
                );
                // one retry scheduled, and nothing after the second failure
                expect(retries).to.have.length(1);
                expect(await adoptionPosts()).to.equal(2);
                await TestSession.settleDetached({
                    expectedErrorIncludes: "injected adoption post send failure"
                });
                expect(
                    await h.query.reducedForkOnChain(sourceForkId)
                ).to.not.equal(ZeroHash);
                expect(
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId
                ).to.equal(sourceForkId);
            } finally {
                await tasks.restore();
                await adoption.restore();
            }
        });

        it("a held adoption of the successor refused because a later reduction is final → settled, not retried", async function () {
            const h = TestSession.getHarness();
            const held = await stageHeldSuccessorAdoption(h);
            let later: FinalLaterReduction | undefined;
            try {
                const { honestIndex } = await openSuccessorDispute(h, held);
                later = await finalizeLaterReduction(h, held, honestIndex);
                // the parked post targets the successor, an older fork the
                // chain reaches on its way to the later final reduction
                expect(later.laterForkId).to.not.equal(held.successorForkId);
                await assertSettledAdoptionRefusal(
                    h,
                    held,
                    "RaceConditionSnapshotUpdateNotLatestFork",
                    later
                );
            } finally {
                await held.release();
                await later?.releaseLaterAdoption();
            }
        });

        it("a held adoption of the successor refused because the successor is disputed → settled, not retried", async function () {
            const h = TestSession.getHarness();
            const held = await stageHeldSuccessorAdoption(h);
            try {
                await openSuccessorDispute(h, held);
                await assertSettledAdoptionRefusal(
                    h,
                    held,
                    "RaceConditionSnapshotUpdateDisputedFork"
                );
            } finally {
                await held.release();
            }
        });
    });

    describe("getSyncedForkDisputes", function () {
        // a dispute commitment lands on-chain before our onDisputeCommitted
        // handler stores the struct. tryReduce firing in that gap used to
        // hit AgreementManager.getForkDisputes and throw "Missing Dispute in
        // storage" - getSyncedForkDisputes now recovers via
        // EventSyncService.loadSynchronizedWindowCommitments before reading storage.
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
