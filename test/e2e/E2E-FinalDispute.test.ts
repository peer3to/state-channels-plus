import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

import { Status } from "@/types";
import { waitFor } from "@test/utils/waitFor";

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

    it("direct final-dispute reduction re-homes a pending leave onto the reduced fork and settles it once", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 },
            // Keep the leave watchdog out of the way: the leave must settle
            // through its exit turn on the reduced fork, not a fallback dispute.
            configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 60_000 }
        });
        const maliciousPeerIndex = 1;
        const leaver = h.getPeer(2);
        let exitPromise: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exitPromise = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        const leave = leaver.p2pInstance.leaveChannel();

        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex
        });
        await h.dispute.resolveFinalDispute(staged);

        // Author only once every honest peer installed the reduced fork and
        // the honest mesh is back in sync; on a loaded farm the reconnect
        // after reduction takes longer than the first write's sync wait.
        const honest = h.getActiveHonestPeers().map((peer) => peer.index);
        const remaining = honest.filter((index) => index !== leaver.index);
        await h.assert.dispute.reductionCompletedWait({
            sourceForkId: staged.forkId,
            reducedForkId: staged.finalResolution.forkId,
            peerIndices: honest
        });
        // The leaver may take its exit turn the moment the reduced fork is
        // installed, so the sync check covers the peers that keep authoring.
        await h.assert.sync.peersInSyncWait({ peerIndices: remaining });

        // The direct reduction path's follow-up moves the pending leave onto
        // the reduced fork; the leaver then takes its exit turn there. Other
        // honest peers author until that turn comes around.
        await waitFor(
            async () => {
                if (exitPromise !== undefined) return true;
                // The next writer is a function of the state at one
                // coordinate, so every honest host at the same height of the
                // reduced fork names the same writer. Right after the direct
                // reduction the remaining hosts can sit at different heights
                // for a moment (one has applied the leaver's exit block, one
                // has not), and a block written on a lagging
                // host's word collides with the exit block. Write only once
                // the hosts hold the same height and name a non-leaver; two
                // writers at one height is a bug, not a race.
                const reducedForkId = staged.finalResolution.forkId;
                const views = await Promise.all(
                    remaining.map(async (index) => {
                        const control = h.control(h.getPeer(index));
                        const heightBefore = await control.query
                            .getLatestBlockHeight(reducedForkId)
                            .request();
                        const next = await control.query
                            .getNextToWrite()
                            .request();
                        const heightAfter = await control.query
                            .getLatestBlockHeight(reducedForkId)
                            .request();
                        return { height: heightBefore, next, heightAfter };
                    })
                );
                const settled = views.every(
                    (view) =>
                        view.height === view.heightAfter &&
                        view.height === views[0].height
                );
                if (!settled) return exitPromise !== undefined;
                const writers = new Set(views.map((view) => view.next));
                if (writers.size !== 1) {
                    throw new Error(
                        `Honest hosts at height ${String(views[0].height)} of fork ${reducedForkId} name different next writers: ${[...writers].join(", ")}`
                    );
                }
                const next = h.peers.find(
                    (peer) => peer.address === views[0].next
                );
                if (!next || next.index === leaver.index) {
                    return exitPromise !== undefined;
                }
                await h.transition.peerWrite({
                    peer: next.index,
                    waitForPeers: honest
                });
                return exitPromise !== undefined;
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
        );
        await exitPromise;
        // The exit block is authored: the leaver never writes again and its
        // outer runtime disposes once the leave settles, so harness queries
        // must stop routing through it now.
        h.contextApi.markAfkPeer({ afkPeerIndex: leaver.index });

        // The leave settles only after the exit snapshot lands on-chain; the
        // remaining honest peers keep the writer slot alive meanwhile.
        let leaveSettled = false;
        const settledLeave = leave.then(() => {
            leaveSettled = true;
        });
        await h.transition.keepAuthoringUntil({
            until: () => leaveSettled,
            waitForPeers: remaining,
            excludePeerIndices: [leaver.index],
            maximumBlocks: 20
        });
        await settledLeave;

        expect(
            (await h.channelManager.getParticipants(h.channelId)).includes(
                leaver.address
            )
        ).to.equal(false);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
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
