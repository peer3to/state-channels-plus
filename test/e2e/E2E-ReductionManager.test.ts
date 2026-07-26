import { expect } from "chai";
import { id } from "ethers";

import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import {
    MathTestSession as TestSession,
    sleep,
    type MathPeerTestHarness
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("E2E: ReductionManager", function () {
    describe("ordinary reduction submission outcomes", function () {
        let h: MathPeerTestHarness;
        let sourceForkId: ForkId;
        const targetPeerIndex = 0;

        beforeEach(async function () {
            this.timeout(90000);
            h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 3 }
            });
            sourceForkId = h.activeForkId!;

            for (const peerIndex of [0, 1, 2, 3]) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubHoldReductionTasks()
                    .request();
            }

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                expectedCount: 1
            });
            await sleep(h.event.evidencePeriodWaitMs(2));
        });

        it("RaceConditionDisputeAlreadyReduced completes the installed reduction as success", async function () {
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionDisputeAlreadyReduced"
            );
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("RaceConditionBlockHeightTooOld completes the installed reduction as success", async function () {
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionBlockHeightTooOld"
            );
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("RaceConditionReductionExpectationDoesntMatch aborts and rejects the operation", async function () {
            const targetPeer = h.getPeer(targetPeerIndex);
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionReductionExpectationDoesntMatch"
            );

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getStatus()
                        .request()) === Status.OPENED,
                20000,
                50
            );
            const hostErrors = await h.quiesceHosts();
            expect(hostErrors.map((error) => error.message)).to.satisfy(
                (messages: string[]) =>
                    messages.some((message) =>
                        message.includes(
                            "RaceConditionReductionExpectationDoesntMatch"
                        )
                    )
            );
            await TestSession.expectFirstDetachedError({
                includes: "RaceConditionReductionExpectationDoesntMatch",
                timeoutMs: 5000
            });
            expect(
                await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
        });

        it("ErrorDisputeInboundMessageBlocksInvalid swallows when another reducer already committed", async function () {
            // beforeEach already holds reduction timers. Also hold snapshot /
            // reduced-commit handlers on the target so the winner's commit
            // cannot complete the target via event-driven tryReduce first.
            const race = await h.rpcStub.holdReductionRace(targetPeerIndex);

            // Another peer must commit first so classifyReductionRace's
            // getReducedResult gate passes (non-ZeroHash reducedForkId).
            const winnerIndex = 1;
            await h.rpcStub.loseReductionRaceWithSimulationError({
                sourceForkId,
                winnerIndex,
                errorName: "ErrorDisputeInboundMessageBlocksInvalid",
                releaseWinner: async () => {
                    await h
                        .control(h.getPeer(winnerIndex))
                        .stub.restoreReductionTasks(true)
                        .request();
                },
                losers: [
                    {
                        index: targetPeerIndex,
                        release: () =>
                            race.release({
                                runHeldTasks: true,
                                replayEvents: false
                            })
                    }
                ]
            });
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
            const hostErrors = await h.quiesceHosts();
            expect(hostErrors).to.deep.equal([]);
            expect(TestSession.getFirstDetachedError()).to.equal(undefined);
        });

        it("ErrorDisputeInboundMessageBlocksInvalid with nothing committed discards the candidate and retries", async function () {
            // No winner is released, so getReducedResult stays ZeroHash and the
            // candidate is classified stale rather than superseded — the branch
            // that declines to install. Nothing else would settle this fork, so
            // the reduction only finishes if the discard reschedules.
            const stopRecordingReduce =
                await h.rpcStub.recordReduce(targetPeerIndex);
            try {
                await h.rpcStub.releaseReductionWithSimulationError(
                    targetPeerIndex,
                    "ErrorDisputeInboundMessageBlocksInvalid"
                );

                // The retry waits a chainFallbackTime, so nothing can be
                // installed yet whether or not the first attempt has landed.
                expect(
                    await h
                        .control(h.getPeer(targetPeerIndex))
                        .query.getCompletedReductionForkId(sourceForkId)
                        .request()
                ).to.equal(null);

                // The injected error is one-shot: the rescheduled attempt
                // recomputes against the real chain and completes.
                await h.assert.dispute.reductionCompletedWait({
                    sourceForkId,
                    peerIndices: [targetPeerIndex]
                });
                expect(
                    await h.rpcStub.reduceCallCount(targetPeerIndex)
                ).to.be.greaterThan(1);
            } finally {
                await stopRecordingReduce();
            }

            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
            const hostErrors = await h.quiesceHosts();
            expect(hostErrors).to.deep.equal([]);
            expect(TestSession.getFirstDetachedError()).to.equal(undefined);
        });

        it("a stale candidate that survives every retry aborts instead of looping", async function () {
            // MAX_STALE_CANDIDATE_RETRIES is 3, so four consecutive stale
            // simulations must exhaust the budget: three reschedules, then the
            // fourth attempt fails the completion.
            const targetPeer = h.getPeer(targetPeerIndex);
            await h
                .control(targetPeer)
                .stub.stubNextReductionSimulationError(
                    "ErrorDisputeInboundMessageBlocksInvalid",
                    4
                )
                .request();
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(true)
                .request();

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getStatus()
                        .request()) === Status.OPENED,
                h.event.protocolEventTimeoutMs(0),
                50
            );
            expect(
                await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
            // The budget is released once exhausted, not left pinned at the cap.
            expect(
                (
                    await h
                        .control(targetPeer)
                        .stub.getStaleRetryState(sourceForkId)
                        .request()
                ).tracked
            ).to.equal(false);
            await TestSession.expectFirstDetachedError({
                includes: "stayed stale across",
                timeoutMs: 5000
            });
        });

        it("a stale candidate holds its backoff against concurrently queued triggers", async function () {
            // Every trigger funnels into the same executor mutex. Without the
            // retry deadline the callers queued behind the first stale attempt
            // would each burn one of the three attempts immediately. Two faults
            // keep the run inside the budget, so this test observes the backoff
            // rather than the exhaustion covered above.
            const targetPeer = h.getPeer(targetPeerIndex);
            await h
                .control(targetPeer)
                .stub.stubNextReductionSimulationError(
                    "ErrorDisputeInboundMessageBlocksInvalid",
                    2
                )
                .request();
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(true)
                .request();

            await waitFor(
                async () =>
                    (
                        await h
                            .control(targetPeer)
                            .stub.getStaleRetryState(sourceForkId)
                            .request()
                    ).attempts >= 1,
                h.event.protocolEventTimeoutMs(0),
                25
            );

            // Fire real triggers inside the backoff window; each enters the same
            // executor mutex, so without the deadline they would each spend an
            // attempt against chain state that has not moved.
            const beforeBurst = await h
                .control(targetPeer)
                .stub.getStaleRetryState(sourceForkId)
                .request();
            await Promise.all(
                [0, 1, 2].map(() =>
                    h
                        .control(targetPeer)
                        .dispute.startReduction(sourceForkId)
                        .request()
                )
            );
            const afterBurst = await h
                .control(targetPeer)
                .stub.getStaleRetryState(sourceForkId)
                .request();
            // The scheduled retry can legitimately land during the burst, so
            // allow one increment — three would mean the burst was charged.
            expect(afterBurst.attempts).to.be.at.most(beforeBurst.attempts + 1);

            // The run stays inside the budget and the reduction still lands.
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            const hostErrors = await h.quiesceHosts();
            expect(hostErrors).to.deep.equal([]);
        });

        it("ErrorDisputeInboundMessageBlocksInvalid on the detached submit aborts the uncommitted candidate", async function () {
            // The staticCall passes, so complete() installs the candidate and
            // settles the completion before submitDetached faults. Nothing can
            // reconcile that install afterwards — the fork has already moved, so
            // no later attempt re-enters the executor for this source fork. The
            // peer must therefore fail closed rather than stay live on a
            // candidate the chain never committed.
            const targetPeer = h.getPeer(targetPeerIndex);
            await h.rpcStub.releaseReductionWithSubmitError(
                targetPeerIndex,
                "ErrorDisputeInboundMessageBlocksInvalid"
            );

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getStatus()
                        .request()) === Status.OPENED,
                h.event.protocolEventTimeoutMs(0),
                50
            );
            await TestSession.expectFirstDetachedError({
                includes: "was rejected on submit",
                timeoutMs: 5000
            });
        });
    });

    it("an empty dispute set posts replacement evidence and resumes the same reduction", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const targetPeer = h.getPeer(0);
        const sourceForkId = h.activeForkId!;

        for (const peer of h.peers) {
            await h
                .control(peer)
                .stub.stubSuppressDisputeInitiation()
                .request();
        }

        await h.tamper.postTamperedDispute(2, (dispute) => {
            dispute.outputSnapshotDataHash = id(
                "empty-dispute-set-invalid-output"
            );
        });
        await h.event.waitForPeers("onDisputeKilled", [targetPeer.index], 1, {
            mode: "atLeast",
            timeoutMs: 15000
        });
        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        sourceForkId
                    )
                ).length === 0,
            10000,
            50
        );

        // The replacement dispute may include the independently elapsed block
        // timeout as evidence, so wait past the harness's full timeout window
        // before asking ReductionManager to construct it.
        await sleep(h.event.participantTimeoutWaitMs(1));
        await h.control(targetPeer).stub.restoreDisputeInitiation().request();
        await h.tamper.stubConstructDispute(0, (dispute) => {
            // This scenario is about the emptied on-chain dispute window. A
            // concurrently detected local block timeout is unrelated evidence
            // and can still be too fresh on another peer's clock, so keep the
            // replacement dispute based only on the persisted on-chain slash.
            const zeroAddress = "0x0000000000000000000000000000000000000000";
            dispute.input.timeout = {
                participant: zeroAddress,
                blockHeight: 0,
                minTimeStamp: 0,
                isForced: false,
                previousBlockProducer: zeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: "0x"
            };
        });
        await h
            .control(targetPeer)
            .dispute.startReduction(sourceForkId)
            .request();

        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        sourceForkId
                    )
                ).length > 0,
            15000,
            50
        );
        await waitFor(
            async () =>
                (await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()) !== null,
            30000,
            50
        );
        expect(
            await h
                .control(targetPeer)
                .query.getCompletedReductionForkId(sourceForkId)
                .request()
        ).to.equal(await h.control(targetPeer).query.getForkId().request());
    });
});
