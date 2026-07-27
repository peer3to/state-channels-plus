import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("Unit: ReductionExecutor", function () {
    describe("getSyncedForkDisputes", function () {
        // a dispute commitment lands on-chain before our onDisputeCommitted
        // handler stores the struct. tryReduce firing in that gap used to
        // hit AgreementManager.getForkDisputes and throw "Missing Dispute in
        // storage" - getSyncedForkDisputes now recovers via
        // EventSyncService.ensureDisputesProcessed before reading storage.
        it("committed dispute missing locally → recovers via event replay, then reduces", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 2);
            const forkId = h.activeForkId!;

            // hold every reduction entry point so nothing auto-reduces -
            // we call tryReduce by hand below
            const race = await h.rpcStub.holdReductionRace(observerIndex);

            // drop the observer's incoming dispute-committed events before
            // any dispute happens: the other honest peers' commitments are
            // then genuinely never delivered here (not merely cleared from
            // storage, which the event-dedup cache would treat as already
            // processed and refuse to redeliver)
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                observerIndex,
                { passFirst: false }
            );

            // real invalid transition -> honest peers dispute + commit on-chain
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedWait();
            // exclude the observer - its own onDisputeCommitted delivery is held
            await h.assert.dispute.committedWait({ peersIndices: [1, 3] });

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
                20000
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
                        reducedDisputeCount: reducedDisputes.length
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

    describe("loadSynchronizedWindowCommitments", function () {
        // the reduction timer and every inbound spectate request enter the same
        // owner. without dedupe each caller runs its own chain read and its own
        // recovery sweep - a remote peer can multiply one request into N.
        it("concurrent callers for the same fork share one chain read; a later call reads again", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;

            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const probe = await h.rpcStub.probeConcurrentWindowLoad(
                observerIndex,
                forkId,
                4
            );

            expect(
                probe.queryCount,
                "four concurrent loads must cause exactly one chain read"
            ).to.equal(1);
            expect(
                probe.commitmentCounts.length,
                "every concurrent caller must get an answer"
            ).to.equal(4);
            expect(
                new Set(probe.commitmentCounts).size,
                "concurrent callers must all see the same window"
            ).to.equal(1);
            // the dedupe is per in-flight batch, not a cache - a load that
            // starts after they settle must observe the chain again
            expect(
                probe.retryQueryCount,
                "a later non-overlapping load must read the chain again"
            ).to.equal(1);
        });

        it("allowRecent reuses the loaded window, and a committed dispute invalidates it", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 2);
            const forkId = h.activeForkId!;

            // freeze the observer's own reduction: a reduction-path load
            // repopulates the retained window and would mask the invalidation
            const race = await h.rpcStub.holdReductionRace(observerIndex);

            const first = await h.rpcStub.probeRetainedWindowLoad(
                observerIndex,
                forkId,
                3
            );
            expect(
                first.queryCount,
                "only the first of three sequential loads may read the chain"
            ).to.equal(1);
            expect(
                new Set(first.commitmentCounts).size,
                "every load must see the same window"
            ).to.equal(1);

            const second = await h.rpcStub.probeRetainedWindowLoad(
                observerIndex,
                forkId,
                2
            );
            expect(
                second.queryCount,
                "the retained window must survive across calls while nothing moves it"
            ).to.equal(0);

            // a real dispute lands and its DisputeCommitted event dispatches -
            // the only thing that can change this window
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait();

            const afterDispute = await h.rpcStub.probeRetainedWindowLoad(
                observerIndex,
                forkId,
                2
            );
            expect(
                afterDispute.queryCount,
                "a committed dispute must invalidate the retained window"
            ).to.equal(1);
            expect(
                afterDispute.commitmentCounts[0],
                "the reloaded window must hold the new commitment"
            ).to.be.greaterThan(0);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
        });

        it("a dispute landing mid-load → the in-flight load does not retain the window it read", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 2);
            const forkId = h.activeForkId!;

            const race = await h.rpcStub.holdReductionRace(observerIndex);

            // park a load inside its chain read
            const heldLoad = await h.rpcStub.holdWindowLoad(
                observerIndex,
                forkId
            );

            // move the window while that load is parked
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait();

            const { queryCountAfterRelease } = await heldLoad.release();

            expect(
                queryCountAfterRelease,
                "the load saw the window move under it, so its result must not be retained"
            ).to.equal(1);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
        });
    });
});
