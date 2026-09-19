import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { assertEmptyWindowRedispute } from "@test/fixtures/EmptyWindowRedisputeStaging";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { clientRootFor } from "@test/fixtures/RuntimeRootObservation";
import {
    MathTestSession as TestSession,
    type MathPeerTestHarness
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("E2E: ReductionManager", function () {
    describe("ordinary reduction submission outcomes", function () {
        let h: MathPeerTestHarness;
        let sourceForkId: ForkId;
        const targetPeerIndex = 0;

        beforeEach(async function () {
            h = TestSession.getHarness();
            ({ sourceForkId } = await h.scenario.stageReducibleDisputedFork({
                peerCount: 4,
                configOverrides: { RUN_SDK_IN_THREAD: false },
                maliciousPeerIndex: 1,
                timeConfig: { evidenceTime: 3 }
            }));
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
            const { query } = runtimeEndpointFor(targetPeer.p2pInstance);
            const host = clientRootFor(
                targetPeer.p2pInstance
            ).p2pRuntimeHostRemoteRoot!;
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionReductionExpectationDoesntMatch"
            );

            await waitFor(
                () => host.isClosed,
                h.event.protocolEventTimeoutMs()
            );
            await TestSession.settleDetached({
                expectedErrorIncludes:
                    "RaceConditionReductionExpectationDoesntMatch"
            });
            expect(query.getCompletedReductionForkId(sourceForkId)).to.equal(
                null
            );
        });
    });

    it("dispute-window recovery defeated → the reduction defers, the peer is not evicted", async function () {
        const h = TestSession.getHarness();
        const laggingIndex = 0;
        const maliciousPeerIndex = 2;
        const healthyIndices = [1, 3];
        const { forkId, race, restoreEvents } =
            await h.scenario.disputeWithSuppressedCommitEvents({
                observerIndex: laggingIndex,
                maliciousPeerIndex
            });

        // a healthy reduction landing while the lagging peer is blinded emits
        // StateSnapshotUpdated for a fork it cannot resolve, which is a fatal
        // detached throw of its own - hold them until the queries come back
        const healthyRaces = [];
        for (const peerIndex of healthyIndices) {
            healthyRaces.push(await h.rpcStub.holdReductionRace(peerIndex));
        }

        const blinded = await h.rpcStub.failChainLogQueries(laggingIndex);
        // before the kill period expires the attempt exits at the gate and
        // never reaches the window read
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

        const commitmentsBefore = (
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).length;
        // no reduction timer is armed while dispute events are held, so the
        // attempt has to be triggered. startReduction, not awaitReduction: the
        // shared completion promise stays pending across a deferral
        await h
            .control(h.getPeer(laggingIndex))
            .dispute.startReduction(forkId)
            .request();

        expect(
            await TestSession.consumeFirstDetachedError(
                h.event.protocolEventTimeoutMs()
            ),
            "a deferred reduction must not surface an error"
        ).to.equal(undefined);
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getStatus()
                .request(),
            "the peer must not be evicted for a window it cannot read"
        ).to.equal(Status.PARTICIPATING);
        expect(
            (await h.channelManager.getWindowCommitments(h.channelId, forkId))
                .length,
            "an unreadable window must not be answered with a fresh dispute"
        ).to.equal(commitmentsBefore);

        // the queries come back before the healthy holds are released, so the
        // lagging peer recovers the window on its own attempt
        await blinded.restore();
        await restoreEvents(false);
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .dispute.awaitReduction(forkId)
                .request(),
            "the recovered attempt must complete the reduction"
        ).to.not.equal(null);

        for (const healthy of healthyRaces) {
            await healthy.release({ replayEvents: true, runHeldTasks: true });
        }
        await race.release({
            replayEvents: true,
            runHeldTasks: false,
            keepTasksHeld: true
        });
        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [laggingIndex, ...healthyIndices]
        });
    });

    it("an empty dispute set posts replacement evidence and resumes the same reduction", async function () {
        await assertEmptyWindowRedispute(TestSession.getHarness(), "wins");
    });

    it("an empty dispute set whose replacement evidence loses the race leaves the reducer participating", async function () {
        await assertEmptyWindowRedispute(TestSession.getHarness(), "losesRace");
    });
});
