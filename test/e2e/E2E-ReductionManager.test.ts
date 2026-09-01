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
                h.event.protocolEventTimeoutMs(),
                50
            );
            await TestSession.settleDetached({
                expectedErrorIncludes:
                    "RaceConditionReductionExpectationDoesntMatch"
            });
            expect(
                await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
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
            mode: "atLeast"
        });
        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        sourceForkId
                    )
                ).length === 0,
            h.event.protocolEventTimeoutMs(),
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
            h.event.protocolEventTimeoutMs(),
            50
        );
        await waitFor(
            async () =>
                (await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()) !== null,
            h.event.protocolEventTimeoutMs(),
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
