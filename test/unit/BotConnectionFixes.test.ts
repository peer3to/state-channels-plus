import { Status, timeoutWaitTime } from "@/types";
import { channelIdToDiscoveryKey, Codec, sleep, Type } from "@/utils";
import {
    chainBlockPastWait,
    exitOnLeaveTurn,
    latestSyncFromResponderBehindDerivedFork,
    prepareJoinWithAuthorization,
    recordDiscoveryKeyJoins,
    recordedForceJoinDeadlineDelays,
    recordSnapshotPostWaitResults,
    requestLatestFrom
} from "@test/fixtures/BotConnectionFixesStaging";
import { holdReductions } from "@test/fixtures/DisputeWindowWorkflowStaging";
import {
    readForceJoinBounds,
    authorUntilForceJoinCountingStarted,
    holdForceJoinMembershipRead,
    observeDisputeRequests,
    type HeldForceJoinMembershipRead,
    runForceJoinBlockBound
} from "@test/fixtures/ForceJoinCountingStaging";
import { postSelfRemovalDispute } from "@test/fixtures/MilestoneProofStartStaging";
import { withHeldFreshRequester } from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

// Plan 35 "Preserve the existing bot-connection fixes" (U70-U76). Every
// component runs with its real collaborators in a teleported session.

describe("Unit: bot-connection fixes", function () {
    describe("lobby discovery announcement", function () {
        it("U70: a lobby open makes both founders join the opened channel's discovery key as participants", async function () {
            const h = TestSession.getHarness();
            await h.setup(2, { autoConnect: false });
            const first = h.getPeer(0);
            const second = h.getPeer(1);
            const firstJoins = await recordDiscoveryKeyJoins(h, first);
            const secondJoins = await recordDiscoveryKeyJoins(h, second);
            try {
                const [firstResult, secondResult] = await Promise.all([
                    first.p2pInstance.p2pSigner.joinLobby(
                        ethers.id("u70-lobby-discovery-announcement")
                    ),
                    second.p2pInstance.p2pSigner.joinLobby(
                        ethers.id("u70-lobby-discovery-announcement")
                    )
                ]);
                const channelId = firstResult!.channelId;
                expect(secondResult!.channelId).to.equal(channelId);
                const channelKey = channelIdToDiscoveryKey(channelId);

                // Each founder joins the key once its own genesis is
                // installed: it joins as a participant, never as an observer
                // that waits for an initial sync.
                const firstChannelJoins = (await firstJoins.joins()).filter(
                    (join) => join.key === channelKey
                );
                const secondChannelJoins = (await secondJoins.joins()).filter(
                    (join) => join.key === channelKey
                );
                expect(firstChannelJoins).to.not.deep.equal([]);
                expect(secondChannelJoins).to.not.deep.equal([]);
                expect(
                    firstChannelJoins.map((join) => join.status)
                ).to.deep.equal(
                    firstChannelJoins.map(() => Status.PARTICIPATING)
                );
                expect(
                    secondChannelJoins.map((join) => join.status)
                ).to.deep.equal(
                    secondChannelJoins.map(() => Status.PARTICIPATING)
                );
                expect(
                    await h.control(first).query.getStatus().request()
                ).to.equal(Status.PARTICIPATING);
                expect(
                    await h.control(second).query.getStatus().request()
                ).to.equal(Status.PARTICIPATING);
            } finally {
                await firstJoins.restore();
                await secondJoins.restore();
            }
        });
    });

    describe("terminal leave settlement", function () {
        it("U71: both founders leave and the last exit closes the channel → both terminal leaves settle on NOT_OPENED", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            const first = h.getPeer(0);
            const second = h.getPeer(1);
            const firstExit = exitOnLeaveTurn(first);
            const secondExit = exitOnLeaveTurn(second);

            const firstLeave = first.p2pInstance.p2pSigner.leaveChannel();
            const secondLeave = second.p2pInstance.p2pSigner.leaveChannel();
            await h.event.waitUntilLeavePhase(first.index, "awaiting-exit");
            await h.event.waitUntilLeavePhase(second.index, "awaiting-exit");

            // One block hands the turn to the leavers; each sends its exit on
            // its leave turn and the second exit leaves no participant.
            await h.transition.advanceState({
                waitForPeers: [first.index, second.index]
            });
            await h.event.waitForPeers(
                "onLeaveTurn",
                [first.index, second.index],
                1
            );
            await firstExit();
            await secondExit();
            await Promise.all([firstLeave, secondLeave]);

            expect(
                (await h.channelManager.isChannelOpen(h.channelId))[0]
            ).to.equal(false);
            expect(
                (await h.channelManager.getParticipants(h.channelId)).length
            ).to.equal(0);
            expect(await h.control(first).query.getStatus().request()).to.equal(
                Status.NOT_OPENED
            );
            expect(
                await h.control(second).query.getStatus().request()
            ).to.equal(Status.NOT_OPENED);
        });
    });

    describe("snapshot post blocked by an unconsumed inbound message", function () {
        it("U72: a same-fork snapshot post waiting on an inbound message its snapshot has not consumed resolves false and posts nothing", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            // The founders omit the join, so the chain holds an inbound
            // message that no snapshot has consumed.
            for (const peerIndex of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(peerIndex);
            }
            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                )
            ).to.equal(true);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            const snapshotBefore = await h.query.getOnChainSnapshotHash();

            const posted = await h.execOnHost(
                h.getPeer(0),
                (sm, args) =>
                    sm.snapshotUpdateService.postStateSnapshotWait(args.forkId),
                { forkId: h.activeForkId! }
            );

            expect(posted).to.equal(false);
            expect(await h.query.getOnChainSnapshotHash()).to.equal(
                snapshotBefore
            );
        });

        it("U72: a leaver whose exit snapshot post is blocked by an unconsumed inbound join gets false and starts its self-removal dispute", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            const leaver = h.getPeer(1);
            for (const peerIndex of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(peerIndex);
            }
            const posts = await recordSnapshotPostWaitResults(h, leaver);
            // The dispute is recorded, not sent: its boundary is the subject.
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                leaver.index
            );
            const exit = exitOnLeaveTurn(leaver);
            try {
                expect(
                    await joiner.p2pInstance.p2pSigner.joinChannel(
                        confirmation,
                        expectedSnapshotHash,
                        expectedForkId
                    )
                ).to.equal(true);
                const snapshotBefore = await h.query.getOnChainSnapshotHash();

                const leave = leaver.p2pInstance.p2pSigner.leaveChannel();
                void leave.catch(() => undefined);
                await h.event.waitUntilLeavePhase(
                    leaver.index,
                    "awaiting-exit"
                );
                await h.transition.keepAuthoringUntil({
                    until: () => exit() !== undefined,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 6
                });
                await exit();
                await waitFor(
                    async () => (await recorder.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );

                expect(await posts.results()).to.deep.equal([false]);
                const [submission] = await recorder.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                expect(await h.query.getOnChainSnapshotHash()).to.equal(
                    snapshotBefore
                );
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.include(leaver.address);
            } finally {
                await posts.restore();
                await recorder.restore();
            }
            await leaver.p2pInstance.dispose();
        });
    });

    describe("latest-state spectate request", function () {
        it("U73: a latest-state request to a responder whose own state is not installed → refused for the chain-derived fork, requester not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const requester = h.getPeer(1);

            const result = await withHeldFreshRequester(
                h,
                async (responder) => {
                    const { refusal, synced } = await requestLatestFrom(
                        h,
                        requester,
                        responder.address
                    );
                    return {
                        refusal,
                        synced,
                        requesterBlacklisted: await h
                            .control(responder)
                            .query.isBlacklisted(requester.address)
                            .request()
                    };
                }
            );

            // The responder serves the fork it derives from the chain, not its
            // own (absent) fork; without that fork's genesis it throws.
            expect(result.refusal).to.equal(
                `No genesis snapshot found for fork ${forkId}`
            );
            expect(result.synced).to.equal(false);
            expect(result.requesterBlacklisted).to.equal(false);
        });

        it("U73: a latest-state request to a responder whose own fork is behind the chain-derived fork → served from the derived fork, neither side blacklisted", async function () {
            const result = await latestSyncFromResponderBehindDerivedFork(
                TestSession.getHarness()
            );

            // the responder's own fork is the disputed source fork
            expect(result.responderOwnFork).to.equal(result.sourceForkId);
            expect(result.successor).to.not.equal(result.sourceForkId);
            expect(result.accepted).to.equal(true);
            expect(result.observerForkId).to.equal(result.successor);
            expect(result.observerBlacklistedResponder).to.equal(false);
            expect(result.responderBlacklistedObserver).to.equal(false);
        });
    });

    describe("force-join time bound", function () {
        it("RO2: seating a join during its deadline membership read prevents a stale dispute request", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            const requests = await observeDisputeRequests(h, joiner.index);
            let read: HeldForceJoinMembershipRead | undefined;
            let running: Promise<void> | undefined;
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(async () => (await deadline.heldCount()) === 1);
                read = await holdForceJoinMembershipRead(h, joiner.index);
                running = deadline.release(true);
                await waitFor(read.entered);
                await h.transition.advanceState({
                    count: 1,
                    waitForFinalization: true
                });
                expect(
                    (await readForceJoinBounds(h, joiner)).submissionHeight
                ).to.equal(null);
                await read.release();
                await running;
                expect(await requests.requests()).to.have.length(0);
                expect(
                    (await readForceJoinBounds(h, joiner)).disputeStarted
                ).to.equal(false);
                expect(await recorder.submissions()).to.deep.equal([]);
                h.assert.dispute.noDisputes();
            } finally {
                await read?.release();
                if (running) await running;
                else await deadline.release(false);
                await requests.restore();
                await recorder.restore();
            }
        });

        it("RO2: the block bound wins while the deadline awaits membership and only one dispute is requested", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const restores = await Promise.all(
                [0, 1, 2].map((index) =>
                    h.byzantine.stubPendingInboundInclusion(index)
                )
            );
            for (const index of [0, 1, 2])
                await h.rpcStub.suppressTimeoutCheck(index);
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            const requests = await observeDisputeRequests(h, joiner.index);
            let read: HeldForceJoinMembershipRead | undefined;
            let running: Promise<void> | undefined;
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(async () => (await deadline.heldCount()) === 1);
                read = await holdForceJoinMembershipRead(h, joiner.index);
                running = deadline.release(true);
                await waitFor(read.entered);
                const bounds = await authorUntilForceJoinCountingStarted(
                    h,
                    joiner.index,
                    [0, 1, 2]
                );
                await h.transition.advanceState({
                    count: bounds.participantCount + 1,
                    waitForPeers: [0, 1, 2, joiner.index]
                });
                await waitFor(
                    async () => (await recorder.submissions()).length === 1
                );
                expect(
                    (await readForceJoinBounds(h, joiner)).disputeStarted
                ).to.equal(true);
                await read.release();
                await running;
                expect(await requests.requests()).to.have.length(1);
                expect(await recorder.submissions()).to.have.length(1);
            } finally {
                await read?.release();
                if (running) await running;
                else await deadline.release(false);
                await requests.restore();
                await recorder.restore();
                await Promise.all(restores.map((restore) => restore()));
            }
        });

        it("RO2: reduction seats the pending join on a successor fork while its old deadline read is held", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const forkId = h.activeForkId!;
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            await h.dispute.suppressDisputeInitiation(
                h.peers.map((peer) => peer.index)
            );
            let read: HeldForceJoinMembershipRead | undefined;
            let running: Promise<void> | undefined;
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(async () => (await deadline.heldCount()) === 1);
                read = await holdForceJoinMembershipRead(h, joiner.index);
                running = deadline.release(true);
                await waitFor(read.entered);
                await postSelfRemovalDispute(h, 0, () => {}, {
                    malicious: false
                });
                const reduced = await h.dispute.resolveDisputeWait({
                    forkId,
                    honestPeerIndices: [1, 2, joiner.index],
                    expectedDisputesCommittedPerPeer: 1,
                    disputesCommittedMode: "atLeast"
                });
                expect(reduced.newForkId).to.not.equal(forkId);
                expect(
                    await h.control(joiner).query.getStatus().request()
                ).to.equal(Status.PARTICIPATING);
                await read.release();
                await running;
                const bounds = await readForceJoinBounds(h, joiner);
                expect(bounds.submissionHeight).to.equal(null);
                expect(bounds.disputeStarted).to.equal(false);
            } finally {
                await read?.release();
                if (running) await running;
                else await deadline.release(false);
            }
        });

        it("AO4: a force-join deadline reads a real expired evidence window and retains the pending join without submitting", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            await holdReductions(h);
            await h.dispute.suppressDisputeInitiation(
                h.peers.map((peer) => peer.index)
            );
            let released = false;
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(async () => (await deadline.heldCount()) === 1);
                await h
                    .control(h.getPeer(0))
                    .dispute.setForceExit(true)
                    .request();
                const opening = await h.dispute.fetchConstructedDispute(0);
                await (
                    await h
                        .getPeer(0)
                        .p2pInstance.stateChannelManagerContract.uploadDisputeWithCalldata(
                            opening.disputeConfirmation,
                            opening.auditingData
                        )
                ).wait();
                const created = Number(
                    await h.channelManager.getDisputeWindowCreationTimestamp(
                        h.channelId,
                        prepared.expectedForkId
                    )
                );
                expect(created).to.be.greaterThan(0);
                const bounds = await readForceJoinBounds(h, joiner);
                await h.event.waitUntilTimestamp(
                    created + bounds.timeConfig.evidenceTime + 1
                );
                await waitFor(() =>
                    h.execOnHost(
                        joiner,
                        async (sm, args) =>
                            Number(
                                await sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                                    sm.channelId,
                                    args.forkId
                                )
                            ) === args.created,
                        { forkId: prepared.expectedForkId, created }
                    )
                );
                released = true;
                await deadline.release(true);
                expect(await recorder.submissions()).to.deep.equal([]);
                const after = await readForceJoinBounds(h, joiner);
                expect(after.submissionHeight).to.equal(
                    bounds.submissionHeight
                );
                expect(after.disputeStarted).to.equal(false);
            } finally {
                if (!released) await deadline.release(false);
                await recorder.restore();
            }
        });

        it("U74: observing its own join arms the force-join deadline at once, one full turn window per pending turn, while the counting grace still runs", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const control = h.control(joiner);
            // Recorded only: the deadline task never runs here.
            await control.stub
                .stubRecordScheduledTasks("force join deadline")
                .request();
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(
                    async () =>
                        (await recordedForceJoinDeadlineDelays(h, joiner))
                            .length > 0,
                    h.event.protocolEventTimeoutMs()
                );
                const clockAtArm = await control.query
                    .getClockTimeInSeconds()
                    .request();
                const bounds = await readForceJoinBounds(h, joiner);

                // The block bound still waits out its agreementTime grace
                // while the deadline is already armed.
                expect(bounds.countingStartsAt).to.not.equal(null);
                expect(clockAtArm).to.be.lessThan(bounds.countingStartsAt!);
                expect(bounds.countingFromHeight).to.equal(null);
                expect(bounds.submissionHeight).to.be.at.least(0);
                expect(
                    await recordedForceJoinDeadlineDelays(h, joiner)
                ).to.deep.equal([
                    (bounds.participantCount + 1) *
                        timeoutWaitTime(
                            bounds.timeConfig,
                            bounds.submissionHeight! + 1
                        ) *
                        1000
                ]);
            } finally {
                await control.stub.restoreRecordScheduledTasks().request();
            }
        });

        it("U74: a submitted join not yet observed on chain starts neither force-join bound while blocks arrive", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const joiner = h.getPeer(prepared.joiner.index);
            const control = h.control(joiner);
            await control.stub.stubRecordScheduledTasks().request();
            const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
                joiner.index,
                "joinChannel"
            );
            try {
                const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
                await waitFor(
                    async () =>
                        (await control.stub
                            .getHeldMembershipReceiptCount()
                            .request()) === 1,
                    h.event.protocolEventTimeoutMs()
                );
                // the founders keep authoring: blocks alone start nothing
                await h.transition.advanceState({
                    count: 4,
                    waitForPeers: [0, 1, 2]
                });

                expect(
                    await recordedForceJoinDeadlineDelays(h, joiner)
                ).to.deep.equal([]);
                const bounds = await readForceJoinBounds(h, joiner);
                expect({
                    submissionRecorded: bounds.submissionHeight !== null,
                    countingStartsAt: bounds.countingStartsAt,
                    countingFromHeight: bounds.countingFromHeight,
                    disputeStarted: bounds.disputeStarted
                }).to.deep.equal({
                    submissionRecorded: true,
                    countingStartsAt: null,
                    countingFromHeight: null,
                    disputeStarted: false
                });
                await releaseSubmission();
                // The table moved on, so the released join may be refused.
                await join;
            } finally {
                await releaseSubmission();
                await control.stub.restoreRecordScheduledTasks().request();
            }
        });

        it("U74: the force-join deadline passing with no new block requests the force-join dispute", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            // The deadline task is held when armed and run in place of its
            // timer; its body is the real one.
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            let deadlineReleased = false;
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await waitFor(
                    async () => (await deadline.heldCount()) === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const armed = await readForceJoinBounds(h, joiner);
                expect(armed.disputeStarted).to.equal(false);
                expect(armed.countingFromHeight).to.equal(null);

                deadlineReleased = true;
                await deadline.release(true);
                await waitFor(
                    async () => (await recorder.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );

                const fired = await readForceJoinBounds(h, joiner);
                expect(fired.disputeStarted).to.equal(true);
                // no block arrived since the join was submitted
                expect(fired.latestBlockHeight).to.equal(
                    armed.submissionHeight
                );
                expect(await recorder.submissions()).to.have.length(1);
            } finally {
                if (!deadlineReleased) await deadline.release(false);
                await recorder.restore();
            }
        });
    });

    describe("own-join observation and join authorization expiry", function () {
        it("U75: a delayed on-chain observation starts the deadline and the counting grace at observation, not at submission", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const control = h.control(joiner);
            await control.stub
                .stubRecordScheduledTasks("force join deadline")
                .request();
            const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
                joiner.index,
                "joinChannel"
            );
            try {
                const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
                await waitFor(
                    async () =>
                        (await control.stub
                            .getHeldMembershipReceiptCount()
                            .request()) === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const clockAtSubmission = await control.query
                    .getClockTimeInSeconds()
                    .request();
                // The observation delay is the test input.
                await sleep(3_000);
                expect(
                    await recordedForceJoinDeadlineDelays(h, joiner)
                ).to.deep.equal([]);
                expect(
                    (await readForceJoinBounds(h, joiner)).countingStartsAt
                ).to.equal(null);

                const clockAtRelease = await control.query
                    .getClockTimeInSeconds()
                    .request();
                await releaseSubmission();
                expect(await join).to.equal(true);
                await waitFor(
                    async () =>
                        (await recordedForceJoinDeadlineDelays(h, joiner))
                            .length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const clockAfterObservation = await control.query
                    .getClockTimeInSeconds()
                    .request();
                const bounds = await readForceJoinBounds(h, joiner);
                const { agreementTime } = bounds.timeConfig;

                // Counting starts agreementTime after the observation (one
                // second of clock adjustment either side), later than
                // agreementTime after the submission.
                expect(bounds.countingStartsAt).to.be.within(
                    clockAtRelease + agreementTime - 1,
                    clockAfterObservation + agreementTime + 1
                );
                expect(bounds.countingStartsAt).to.be.greaterThan(
                    clockAtSubmission + agreementTime
                );
                // the deadline gets its full turn windows from observation
                expect(
                    await recordedForceJoinDeadlineDelays(h, joiner)
                ).to.deep.equal([
                    (bounds.participantCount + 1) *
                        timeoutWaitTime(
                            bounds.timeConfig,
                            bounds.submissionHeight! + 1
                        ) *
                        1000
                ]);
            } finally {
                await releaseSubmission();
                await control.stub.restoreRecordScheduledTasks().request();
            }
        });

        it("U75: an uncertain join that never reaches the chain → own join state open until the chain passes its authorization deadline, then expired", async function () {
            const h = TestSession.getHarness();
            const prepared = await prepareJoinWithAuthorization(h, 10);
            const signer = prepared.joiner.p2pInstance.p2pSigner;
            const restore = await h.rpcStub.failMembershipSubmissionUncertain(
                prepared.joiner.index,
                "joinChannel"
            );
            try {
                expect(
                    await signer.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);

                // the remaining time is counted on the joiner's own clock, so
                // bound it by that clock read just before and just after
                const joinerQuery = h.control(prepared.joiner).query;
                const clockBefore = await joinerQuery
                    .getClockTimeInSeconds()
                    .request();
                const open = await signer.getOwnJoinState();
                const clockAfter = await joinerQuery
                    .getClockTimeInSeconds()
                    .request();
                expect(open.state).to.equal("open");
                expect(
                    open.state === "open" ? open.secondsUntilExpiry : 0
                ).to.be.within(
                    Math.max(prepared.joinDeadline + 1 - clockAfter, 1),
                    Math.max(prepared.joinDeadline + 1 - clockBefore, 1)
                );

                await chainBlockPastWait(h, prepared.joinDeadline);
                expect(await signer.getOwnJoinState()).to.deep.equal({
                    state: "expired"
                });
                // a read only: the runtime stays pending
                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.PENDING_PARTICIPANT
                );
            } finally {
                await restore();
            }
        });

        it("U75: a pending joiner whose join never lands → its leave waits for the join and settles back to SYNCED once the authorization expired on chain", async function () {
            const h = TestSession.getHarness();
            const prepared = await prepareJoinWithAuthorization(h, 8);
            const joiner = prepared.joiner;
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            const restore = await h.rpcStub.failMembershipSubmissionUncertain(
                joiner.index,
                "joinChannel"
            );
            try {
                expect(
                    await joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);
                const leave = joiner.p2pInstance.p2pSigner.leaveChannel();
                let leaveSettled = false;
                const settled = leave.then(() => {
                    leaveSettled = true;
                });
                await h.event.waitUntilLeavePhase(
                    joiner.index,
                    "awaiting-join"
                );
                expect(leaveSettled).to.equal(false);

                // The founders keep authoring through the wait.
                await Promise.all([
                    chainBlockPastWait(h, prepared.joinDeadline),
                    h.transition.keepAuthoringUntil({
                        until: () => leaveSettled,
                        waitForPeers: [0, 1, 2],
                        maximumBlocks: 20
                    })
                ]);
                await settled;

                expect(
                    await h.control(joiner).query.getStatus().request()
                ).to.equal(Status.SYNCED);
                expect(
                    await joiner.p2pInstance.p2pSigner.getOwnJoinState()
                ).to.deep.equal({ state: "none" });
                expect(await recorder.submissions()).to.deep.equal([]);
            } finally {
                await restore();
                await recorder.restore();
            }
        });

        it("U75: a join observed during the leave's join wait turns the leave into a member's leave", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const joiner = prepared.joiner;
            // the join lands but the joiner does not observe it yet
            const held = await h.rpcStub.holdInboundMessageEvents(joiner.index);
            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            const leave = joiner.p2pInstance.p2pSigner.leaveChannel();
            void leave.catch(() => undefined);
            await h.event.waitUntilLeavePhase(joiner.index, "awaiting-join");
            expect(
                (await readForceJoinBounds(h, h.getPeer(joiner.index)))
                    .countingStartsAt
            ).to.equal(null);

            await held.release({ replay: true });

            await h.event.waitUntilLeavePhase(joiner.index, "awaiting-exit");
            expect(
                (await readForceJoinBounds(h, h.getPeer(joiner.index)))
                    .countingStartsAt
            ).to.not.equal(null);
            await joiner.p2pInstance.dispose();
            await expect(leave).to.be.rejectedWith("disposed");
        });
    });

    describe("force-join block bound grace", function () {
        it("U76: blocks committed during the agreementTime grace after the joiner observes its join are not counted; counting starts at the first block after it", async function () {
            const run = await runForceJoinBlockBound(TestSession.getHarness());

            // Two blocks inside the grace counted nothing and fired nothing.
            expect(run.afterGraceBlocks.countingFromHeight).to.equal(null);
            expect(run.afterGraceBlocks.disputeStarted).to.equal(false);
            // The first block after the grace starts the count, and the
            // participants + 1 blocks below the bound fire nothing.
            expect(run.belowBound.countingFromHeight).to.equal(
                run.firstCountedHeight
            );
            expect(run.belowBound.latestBlockHeight).to.equal(
                run.firstCountedHeight + run.bound - 1
            );
            expect(run.belowBound.disputeStarted).to.equal(false);
            expect(run.submissionsBelowBound).to.equal(0);
        });
    });
});
