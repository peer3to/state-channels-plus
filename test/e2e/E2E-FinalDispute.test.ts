import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

import { Status } from "@/types";

describe("E2E: final dispute resolution", function () {
    it("threshold-final dispute installs its exact output and can post the next snapshot", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });

        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 1
        });
        await h.dispute.resolveFinalDispute(staged);

        const honestPeerIndices = h.getActiveHonestPeers().map((p) => p.index);
        await h.assert.dispute.reductionCompletedWait({
            sourceForkId: staged.forkId,
            reducedForkId: staged.finalResolution.forkId,
            peerIndices: honestPeerIndices
        });

        const targetPeer = h.getPeer(honestPeerIndices[0]);
        const validationCalls = await h.execOnHost(
            targetPeer,
            async (sm, args) => {
                const validation = sm.disputeValidationService;
                const original = validation.validateDispute.bind(validation);
                let calls = 0;
                validation.validateDispute = (async () => {
                    calls += 1;
                    throw new Error(
                        "Late non-final dispute unexpectedly entered validation"
                    );
                }) as typeof validation.validateDispute;
                try {
                    await sm.eventHandler.onDisputeCommitted(
                        args.channelId,
                        args.disputeConfirmation,
                        args.disputeCreationTimestamp,
                        false,
                        args.windowCreationTimestamp,
                        args.disputeAuditingData
                    );
                    return calls;
                } finally {
                    validation.validateDispute = original;
                }
            },
            {
                channelId: h.channelId,
                disputeConfirmation: staged.disputeConfirmation,
                disputeCreationTimestamp:
                    staged.finalResolution.genesisTimestamp,
                windowCreationTimestamp:
                    staged.finalResolution.genesisTimestamp,
                disputeAuditingData: undefined
            }
        );
        expect(validationCalls).to.equal(0);

        await h.assert.sync.onlyHonestPeersInSync();
        await h.transition.fromHonestPeersOnly((contract) => contract.add(1));
        const expectedSnapshot = await h.transition.postSnapshot({
            peerIndex: honestPeerIndices[0],
            forkId: String(staged.finalResolution.forkId)
        });
        expect(expectedSnapshot).to.not.equal(undefined);
        await h.assert.snapshot.localSnapshotsChangedWait({
            expectedSnapshot
        });
    });

    it("threshold-final dispute makes a queued reduction timeout a no-op", async function () {
        const h = TestSession.getHarness();
        const targetPeerIndex = 0;
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            // Keep the ordinary dispute active while the threshold-final
            // payload is assembled under parallel-run load.
            timeConfig: { evidenceTime: 15 }
        });
        const targetPeer = h.getPeer(targetPeerIndex);
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();

        try {
            const forkId = await h.dispute.openOrdinaryDisputeWindow({
                maliciousPeerIndex: 1,
                excludedPeerIndex: 3
            });
            const staged = await h.dispute.submitFinalDisputeFromStoredEvidence(
                {
                    forkId,
                    finalAuthorPeerIndex: 3
                }
            );
            await h.dispute.resolveFinalDispute(staged, {
                expectedDisputesCommittedPerPeer: 2
            });
            expect(
                await h
                    .control(targetPeer)
                    .stub.getHeldReductionTaskCount()
                    .request()
            ).to.be.greaterThan(0);
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(1);

            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(true)
                .request();
            await h.event.waitWhileEventCountsStayAtMost(
                "onSetState",
                [targetPeerIndex],
                { durationMs: 2000, maxCount: 1 }
            );
            expect(
                await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(staged.forkId)
                    .request()
            ).to.equal(staged.finalResolution.forkId);
        } finally {
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request()
                .catch(() => {});
        }
    });

    it("duplicate completion is idempotent", async function () {
        const h = TestSession.getHarness();
        const targetPeerIndex = 0;
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 1
        });
        await h.dispute.resolveFinalDispute(staged);
        const targetPeer = h.getPeer(targetPeerIndex);

        expect(
            await h
                .control(targetPeer)
                .dispute.awaitReduction(staged.forkId)
                .request()
        ).to.equal(staged.finalResolution.forkId);

        expect((await h.peerForkIds([targetPeer]))[0]).to.equal(
            staged.finalResolution.forkId
        );
    });

    it("missed final-dispute delivery recovers the exact final output during reduction", async function () {
        const h = TestSession.getHarness();
        const targetPeerIndex = 2;
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            // The test posts an ordinary dispute and then assembles a second,
            // threshold-final payload inside the same evidence window.
            timeConfig: { evidenceTime: 6 }
        });
        const forkId = await h.dispute.openOrdinaryDisputeWindow({
            maliciousPeerIndex: 1,
            excludedPeerIndex: 3
        });
        const releaseHeld = await h.rpcStub.holdDisputeCommittedEvents(
            targetPeerIndex,
            {
                passFirst: false
            }
        );

        try {
            const staged = await h.dispute.submitFinalDisputeFromStoredEvidence(
                {
                    forkId,
                    finalAuthorPeerIndex: 3
                }
            );
            await h.dispute.resolveFinalDispute(staged, {
                expectedDisputesCommittedPerPeer: 2
            });
            expect(
                await h.rpcStub.getHeldDisputeCommittedCount(targetPeerIndex)
            ).to.be.greaterThan(0);
            expect(
                (await h.peerForkIds([h.getPeer(targetPeerIndex)]))[0]
            ).to.equal(staged.finalResolution.forkId);
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getGenesisSnapshotTimestamp(
                        staged.finalResolution.forkId
                    )
                    .request()
            ).to.equal(staged.finalResolution.genesisTimestamp);
        } finally {
            await releaseHeld(false).catch(() => {});
        }
    });

    it("failed final-dispute preparation propagates without abandoning participation", async function () {
        const h = TestSession.getHarness();
        const targetPeerIndex = 0;
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const restorePreparation =
            await h.rpcStub.failNextFinalDisputePreparation(targetPeerIndex);

        try {
            const staged = await h.dispute.submitFinalDispute({
                maliciousPeerIndex: 1
            });
            await h.dispute.resolveFinalDispute(staged, {
                honestPeerIndices: [2, 3],
                syntheticOnChainParticipants: 1
            });
            await TestSession.settleDetached({
                expectedErrorIncludes:
                    "Forced final-dispute output preparation failure"
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        } finally {
            await restorePreparation().catch(() => {});
        }
    });
});
