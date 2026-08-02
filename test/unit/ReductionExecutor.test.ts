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
});
