import { Status, timeoutWaitTime } from "@/types";
import {
    addressesEqual,
    channelIdToDiscoveryKey,
    Codec,
    sleep,
    Type
} from "@/utils";
import {
    chainBlockPastWait,
    chainNonceReader,
    countFinalizedBlocks,
    disputeOmittedJoin,
    exitOnLeaveTurn,
    latestRequestToResponderBehindChainFork,
    latestSyncFromResponderBehindDerivedFork,
    prepareJoinWithAuthorization,
    readForceExit,
    recordDiscoveryKeyJoins,
    recordLeaveChannelLogs,
    recordedForceJoinDeadlineDelays,
    recordHostErrors,
    recordSnapshotPostWaitResults,
    runLeaveCheck,
    stageInboundBlockedExit,
    stageExitPostAndOwnDisputeHeld,
    stageExitReplacedBySeatingFork,
    stageInboundBlockedProtocolExit,
    stageLastExitBlockedByJoin,
    stageLeaveAwaitingTurn
} from "@test/fixtures/BotConnectionFixesStaging";
import { UNEXPECTED_SNAPSHOT_POST_FAILURE } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { holdReductions } from "@test/fixtures/DisputeWindowWorkflowStaging";
import {
    readForceJoinBounds,
    authorUntilForceJoinCountingStarted,
    holdForceJoinDeadlineParticipantRead,
    holdForceJoinMembershipRead,
    isJoinCheckQueued,
    JOIN_TIMER_NAMES,
    isJoinPending,
    observeDisputeRequests,
    readTrackedJoin,
    type HeldForceJoinMembershipRead,
    runForceJoinBlockBound,
    waitForJoinChecks
} from "@test/fixtures/ForceJoinCountingStaging";
import { stageLoneLeaverSelfRemoval } from "@test/fixtures/LoneLeaverStaging";
import { postSelfRemovalDispute } from "@test/fixtures/MilestoneProofStartStaging";
import {
    stageAdoptionClosingBeforeLeavePost,
    stageCommitCheckQueuedBehindLeaverPost,
    stageLeavePostClosingBeforeAdoption
} from "@test/fixtures/NonFinalZeroParticipantReductionStaging";
import { postSnapshotFrom } from "@test/fixtures/ProofOwnerStaging";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
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
        it("U71: both founders leave and the last exit closes the channel → both get onLeftChannel on NOT_OPENED", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            const first = h.getPeer(0);
            const second = h.getPeer(1);
            const firstExit = exitOnLeaveTurn(first);
            const secondExit = exitOnLeaveTurn(second);

            await first.p2pInstance.p2pSigner.leaveChannel();
            await second.p2pInstance.p2pSigner.leaveChannel();

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
            await h.event.waitUntilLeftChannel(first.index);
            await h.event.waitUntilLeftChannel(second.index);

            expect(
                (await h.channelManager.isChannelOpen(h.channelId))[0]
            ).to.equal(false);
            expect(
                (await h.channelManager.getParticipants(h.channelId)).length
            ).to.equal(0);
            // the channel close lands after the membership drop that reports the leave
            await h.event.waitUntilPeerStatus(first.index, Status.NOT_OPENED);
            await h.event.waitUntilPeerStatus(second.index, Status.NOT_OPENED);
        });

        it("U71: a last leaver whose exit leaves no participant and whose posts a JOIN that no block consumes refuses makes one follow-up post per queued trigger, never back-to-back posts", async function () {
            const h = TestSession.getHarness();
            const { leaver, posts, restore } =
                await stageLastExitBlockedByJoin(h);
            try {
                // the parked post runs and its refusal is parked
                await posts.holdResults();
                await posts.releaseStarts();
                expect(
                    await posts.resultsWait(1),
                    "premise: the unconsumed JOIN refuses the post"
                ).to.deep.equal(["RaceConditionPendingInboundNotConsumed"]);

                // one check while that post is parked: the state has no
                // participant and the chain still lists the leaver, so it
                // queues one post
                expect(await runLeaveCheck(h, leaver)).to.equal(true);
                await posts.releaseResults();
                expect(await posts.resultsWait(2)).to.deep.equal([
                    "RaceConditionPendingInboundNotConsumed",
                    "RaceConditionPendingInboundNotConsumed"
                ]);

                // absence window: no member is left to finalize a block and
                // nothing lands on chain, so no trigger comes; a replay of
                // the follow-up post would have started by now
                await sleep(3_000);
                expect(await posts.started()).to.equal(2);
            } finally {
                await restore();
            }
        });
    });

    describe("exit settled by a posted snapshot", function () {
        it("U72: a same-fork snapshot post waiting on an inbound message its snapshot has not consumed reverts with the pending-inbound refusal and posts nothing", async function () {
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

            const posted = await postSnapshotFrom(h, 0);

            expect(posted).to.equal("RaceConditionPendingInboundNotConsumed");
            expect(await h.query.getOnChainSnapshotHash()).to.equal(
                snapshotBefore
            );
        });

        it("U72: a leaver posts the latest state snapshot once its exit block is final, and that snapshot settles the leave with no dispute", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const leaver = h.getPeer(1);
            const disputes = await h.rpcStub.recordDisputeSubmissions(
                leaver.index
            );
            const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
            const exit = exitOnLeaveTurn(leaver);
            try {
                await leaver.p2pInstance.p2pSigner.leaveChannel();
                await h.transition.keepAuthoringUntil({
                    until: () => exit() !== undefined,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 6
                });
                await exit();
                // the finalized exit block makes the leaver post, and its
                // own post is mined
                await send.waitUntilHeld();
                expect(await send.release()).to.equal(null);
                expect(await disputes.submissions()).to.deep.equal([]);
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
            } finally {
                await send.release();
            }
        });

        it("U72: a leaver whose exit is blocked by an inbound join that no block consumes posts again on each finalized block and starts one self-removal dispute when the one leave watchdog expires", async function () {
            const h = TestSession.getHarness();
            // the production default
            const watchdogMs = 15_000;
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin(4, {
                configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: watchdogMs }
            });
            const leaver = h.getPeer(1);
            // the omitted join is staging: the joiner's force-join dispute is recorded, not started
            await h
                .control(joiner)
                .stub.stubSuppressForceJoinDispute()
                .request();
            for (const peerIndex of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(peerIndex);
            }
            const posts = await recordSnapshotPostWaitResults(h, leaver);
            // The watchdog is held until the reposts are checked, then expires
            // on release; installed first, so the task recorder still sees its delay.
            const watchdog = await h.rpcStub.holdScheduledTasks(
                leaver.index,
                "channel leave watchdog"
            );
            const tasks = await h.rpcStub.recordScheduledTasks(leaver.index);
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

                await leaver.p2pInstance.p2pSigner.leaveChannel();
                await h.transition.keepAuthoringUntil({
                    until: () => exit() !== undefined,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 6
                });
                await exit();
                expect((await posts.resultsWait(1))[0]).to.equal(
                    "RaceConditionPendingInboundNotConsumed"
                );

                // the remaining participants' blocks still omit the join:
                // each finalized block posts again, sends nothing and starts
                // no dispute
                await h.transition.advanceState({
                    count: 2,
                    waitForPeers: [0, 2]
                });
                const reposted = await posts.resultsWait(2);
                expect(reposted).to.deep.equal(
                    reposted.map(() => "RaceConditionPendingInboundNotConsumed")
                );
                expect(await recorder.submissions()).to.deep.equal([]);

                // the one watchdog armed by the leave call bounds the exit
                expect(
                    (await tasks.tasks())
                        .filter(
                            (task) => task.taskName === "channel leave watchdog"
                        )
                        .map((task) => task.delayMs)
                ).to.deep.equal([watchdogMs]);
                expect(await watchdog.heldCount()).to.equal(1);
                await tasks.restore();
                await watchdog.release(true);
                await waitFor(
                    async () => (await recorder.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
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
                await tasks.restore();
                await watchdog.release(false);
                await recorder.restore();
            }
            await leaver.p2pInstance.dispose();
        });

        it("U72: a leaver whose exit is blocked by an inbound join posts the exit once the remaining participants' finalized block consumes the join, with no self-removal dispute", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                leaver,
                remainingPeerIndices,
                posts,
                disputes,
                includeInboundAgain
            } = await stageInboundBlockedExit(h);
            const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
            try {
                // the remaining participants include the join again; their
                // next finalized block consumes it
                await includeInboundAgain();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                // the leaver's own post of the latest snapshot is sent, and
                // it is mined
                await send.waitUntilHeld();
                expect(await send.release()).to.equal(null);
                await waitFor(
                    async () =>
                        !(
                            await h.channelManager.getParticipants(h.channelId)
                        ).includes(leaver.address),
                    h.event.protocolEventTimeoutMs()
                );
                const results = await posts.results();
                expect(results.at(-1)).to.equal("posted");
                expect(results.slice(0, -1)).to.deep.equal(
                    results
                        .slice(0, -1)
                        .map(() => "RaceConditionPendingInboundNotConsumed")
                );
                expect(await disputes.submissions()).to.deep.equal([]);
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.include(joiner.address);
            } finally {
                await send.release();
            }
        });

        it("U72: blocks finalized while the exit's snapshot post runs queue one more post after it when that post did not land the exit, and the next finalized block posts again", async function () {
            const h = TestSession.getHarness();
            const { leaver, remainingPeerIndices, posts, disputes } =
                await stageInboundBlockedExit(h);
            const finalized = countFinalizedBlocks(leaver);
            try {
                await posts.holdResults();
                const startedBefore = await posts.started();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                // that block's post runs and its result is parked
                await waitFor(
                    async () => (await posts.started()) > startedBefore,
                    h.event.protocolEventTimeoutMs()
                );
                const started = await posts.started();
                // two more blocks finalize while that post runs
                const finalizedBefore = finalized();
                await h.transition.advanceState({
                    count: 2,
                    waitForPeers: remainingPeerIndices
                });
                await waitFor(
                    async () => finalized() >= finalizedBefore + 2,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await posts.started()).to.equal(started);

                // the refused post did not land the exit: the blocks finalized
                // during it queue exactly one more post
                await posts.releaseResults();
                await waitFor(
                    async () => (await posts.started()) === started + 1,
                    h.event.protocolEventTimeoutMs()
                );
                await posts.resultsWait(started + 1);
                // absence window: a second queued post would have started by
                // now, right after the queued post returned
                await sleep(2_000);
                expect(await posts.started()).to.equal(started + 1);

                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                await waitFor(
                    async () => (await posts.started()) > started + 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await disputes.submissions()).to.deep.equal([]);
            } finally {
                await posts.restore();
            }
        });

        it("U72: a leaver whose exit the remaining participants post while it sees no further block settles the leave, and the leave watchdog starts no self-removal dispute", async function () {
            // the longer watchdog runs past the default test timeout
            this.timeout(90_000);
            const h = TestSession.getHarness();
            // twice the production default: a watchdog firing as the exit lands
            // is FIND-LEAVE-5-A1XAA4, recorded open; here it fires well after
            const watchdogMs = 30_000;
            const {
                leaver,
                remainingPeerIndices,
                posts,
                disputes,
                includeInboundAgain
            } = await stageInboundBlockedExit(h, { watchdogMs });
            const watchdogExpiresBy = Date.now() + watchdogMs;
            // blind to gossip: the leaver finalizes no further block and posts nothing more
            const restoreConfirmations =
                await h.rpcStub.dropNetworkConfirmations(leaver.index);
            try {
                const startedBefore = await posts.started();
                await includeInboundAgain();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices,
                    waitForFinalization: true
                });
                await h.transition.postSnapshot({ peerIndex: 0 });
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);

                // the settled exit cancelled its watchdog
                await h.transition.keepAuthoringUntil({
                    until: () => Date.now() > watchdogExpiresBy + 1_000,
                    waitForPeers: remainingPeerIndices,
                    maximumBlocks: 8
                });
                expect(await disputes.submissions()).to.deep.equal([]);
                expect(await posts.started()).to.equal(startedBefore);
            } finally {
                await restoreConfirmations();
            }
        });

        it("U72: disposing a leaver whose exit is blocked stops its posts: the block that consumes the join sends nothing from it", async function () {
            const h = TestSession.getHarness();
            const { leaver, remainingPeerIndices, includeInboundAgain } =
                await stageInboundBlockedExit(h);
            const leaverNonce = await chainNonceReader(h, leaver);
            await includeInboundAgain();
            await leaver.p2pInstance.dispose();
            h.contextApi.markAfkPeer({ afkPeerIndex: leaver.index });
            const nonceBefore = await leaverNonce();

            await h.transition.advanceState({
                waitForPeers: remainingPeerIndices
            });
            // absence window: a late post would be mined by now
            await sleep(2_000);
            expect(await leaverNonce()).to.equal(nonceBefore);
            expect(
                await h.channelManager.getParticipants(h.channelId)
            ).to.include(leaver.address);
        });

        it("U72: a dispute observed while the leave awaits its leave turn makes the leaver submit its self-removal dispute at once, with no evidence comparison and before the leave watchdog; the leave completes only on the reduced snapshot that drops it, and the leaver posts no snapshot of that reduced state, which keeps other participants", async function () {
            const h = TestSession.getHarness();
            const { joiner, leaver, disputes, posts } =
                await stageLeaveAwaitingTurn(h, {
                    watchdogMs: 60_000,
                    forwardDisputes: true
                });
            const forkId = h.activeForkId!;
            const comparisons = await h.rpcStub.recordEvidenceComparisons(
                leaver.index
            );
            try {
                await disputeOmittedJoin(h, joiner.index);
                await waitFor(
                    async () => (await disputes.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const [submission] = await disputes.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                expect(await comparisons.comparisons()).to.deep.equal([]);
                // its own dispute does not complete the leave
                expect(leaver.eventSpies.onLeftChannel?.called).to.equal(false);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.include(leaver.address);

                await h.dispute.resolveDisputeWait({
                    forkId,
                    honestPeerIndices: [0, 2],
                    assertMaliciousRemoved: false
                });
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
                expect(await disputes.submissions()).to.have.length(1);
                // a remaining participant adopts the reduced fork
                expect(await posts.started()).to.equal(0);
            } finally {
                await comparisons.restore();
                await disputes.restore();
            }
        });

        it("U72: a dispute observed after an exit block the application authored with no leave call makes the leaver submit its self-removal dispute at once, with no evidence comparison; the reduced snapshot drops it and its runtime is SYNCED with the self-removal still set", async function () {
            const h = TestSession.getHarness();
            const { joiner, leaver, disputes } =
                await stageInboundBlockedProtocolExit(h, {
                    watchdogMs: 60_000,
                    forwardDisputes: true
                });
            const forkId = h.activeForkId!;
            const comparisons = await h.rpcStub.recordEvidenceComparisons(
                leaver.index
            );
            try {
                // the exit is pending from its block, with no leave call
                expect(await readForceExit(h, leaver)).to.equal(true);
                await disputeOmittedJoin(h, joiner.index);
                await waitFor(
                    async () => (await disputes.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const [submission] = await disputes.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                expect(await comparisons.comparisons()).to.deep.equal([]);

                await h.dispute.resolveDisputeWait({
                    forkId,
                    honestPeerIndices: [0, 2],
                    assertMaliciousRemoved: false
                });
                await h.event.waitUntilPeerStatus(leaver.index, Status.SYNCED);
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
                // a started exit is never retracted
                expect(await readForceExit(h, leaver)).to.equal(true);
                expect(await disputes.submissions()).to.have.length(1);
            } finally {
                await comparisons.restore();
                await disputes.restore();
            }
        });

        it("U72: a leave watchdog that expires after the leaver submitted its self-removal dispute for an observed dispute, while that fork is still disputed, starts no second dispute; the leave completes once on the reduced snapshot that drops it", async function () {
            const h = TestSession.getHarness();
            const { joiner, leaver, disputes, expireWatchdog } =
                await stageLeaveAwaitingTurn(h, {
                    holdWatchdog: true,
                    forwardDisputes: true
                });
            const forkId = h.activeForkId!;
            const hostErrors = recordHostErrors(leaver);
            const logs = await recordLeaveChannelLogs(h, leaver);
            try {
                // the observed dispute makes the leaver submit its own
                await disputeOmittedJoin(h, joiner.index);
                await waitFor(
                    async () => (await disputes.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                const [submission] = await disputes.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                // the fork is still disputed and not reduced
                expect(
                    await h.control(leaver).query.didIDispute(forkId).request()
                ).to.equal(true);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.include(leaver.address);

                // the watchdog expires while that dispute is open: it
                // starts nothing
                await expireWatchdog();
                expect(
                    (await logs.entries()).map((entry) => entry.message)
                ).to.not.include("Starting the leave's self-removal dispute");

                await h.dispute.resolveDisputeWait({
                    forkId,
                    honestPeerIndices: [0, 2],
                    assertMaliciousRemoved: false
                });
                await h.event.waitUntilLeftChannel(leaver.index);
                await TestSession.settleDetached();
                expect(await disputes.submissions()).to.have.length(1);
                expect(
                    h.event.getEventCallCount(leaver.index, "onLeftChannel")
                ).to.equal(1);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
                expect(hostErrors.errors).to.deep.equal([]);
            } finally {
                await logs.restore();
                await disputes.restore();
                hostErrors.remove();
            }
        });

        it("U72: an exit snapshot that lands before the leaver's self-removal dispute is sent makes the chain refuse that upload with ErrorCantParticipateInDispute; the refusal is not fatal and the leave completes once, SYNCED with no abort", async function () {
            const h = TestSession.getHarness();
            const { leaver, send, disputes, hostErrors, restore } =
                await stageExitPostAndOwnDisputeHeld(h);
            try {
                // the exit snapshot lands first: the released post, or the
                // post queued behind it when the released one was of an
                // earlier finalized state
                expect(await send.release()).to.equal(null);
                await waitFor(
                    async () =>
                        !(
                            await h.channelManager.getParticipants(h.channelId)
                        ).includes(leaver.address),
                    h.event.protocolEventTimeoutMs()
                );

                // then the parked dispute is sent, and the chain refuses it
                await disputes.release();
                await waitFor(
                    async () =>
                        (await disputes.submissions())[0].revert !== null,
                    h.event.protocolEventTimeoutMs()
                );
                const [submission] = await disputes.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                expect(submission.revert?.name).to.equal(
                    "ErrorCantParticipateInDispute"
                );

                await h.event.waitUntilPeerStatus(leaver.index, Status.SYNCED);
                await h.event.waitUntilLeftChannel(leaver.index);
                await TestSession.settleDetached();
                expect(await disputes.submissions()).to.have.length(1);
                expect(
                    h.event.getEventCallCount(leaver.index, "onLeftChannel")
                ).to.equal(1);
                expect(
                    h.event.getEventCallCount(leaver.index, "onAbort")
                ).to.equal(0);
                expect(
                    await h.control(leaver).query.getStatus().request()
                ).to.equal(Status.SYNCED);
                expect(hostErrors).to.deep.equal([]);
            } finally {
                await restore();
            }
        });

        it("U72: an exit block the application authored with no leave call is posted the same way: a later finalized block's post lands it once the join is consumed, and the runtime ends SYNCED with onLeftChannel, the self-removal still set and no dispute", async function () {
            const h = TestSession.getHarness();
            const {
                leaver,
                remainingPeerIndices,
                posts,
                disputes,
                includeInboundAgain
            } = await stageInboundBlockedProtocolExit(h);
            const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
            try {
                // the exit is pending from its block, with no leave call
                expect(await readForceExit(h, leaver)).to.equal(true);
                await includeInboundAgain();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                await send.waitUntilHeld();
                expect(await send.release()).to.equal(null);
                await h.event.waitUntilPeerStatus(leaver.index, Status.SYNCED);
                await h.event.waitUntilLeftChannel(leaver.index);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
                expect((await posts.results()).at(-1)).to.equal("posted");
                // a started exit is never retracted
                expect(await readForceExit(h, leaver)).to.equal(true);
                expect(await disputes.submissions()).to.deep.equal([]);
            } finally {
                await send.release();
            }
        });

        it("U72: a block finalized while the exit's snapshot post runs queues no further post when that post lands the exit: the leaver sends once and posts no more", async function () {
            const h = TestSession.getHarness();
            const {
                leaver,
                remainingPeerIndices,
                posts,
                disputes,
                includeInboundAgain
            } = await stageInboundBlockedExit(h);
            const finalized = countFinalizedBlocks(leaver);
            const leaverNonce = await chainNonceReader(h, leaver);
            const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
            try {
                const startedBefore = await posts.started();
                const nonceBefore = await leaverNonce();
                // the remaining participants' next finalized block consumes
                // the join; its post is parked at its send
                await includeInboundAgain();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                await send.waitUntilHeld();
                expect(await posts.started()).to.equal(startedBefore + 1);

                // another block finalizes while that post runs
                const finalizedBefore = finalized();
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                await waitFor(
                    async () => finalized() > finalizedBefore,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await posts.started()).to.equal(startedBefore + 1);

                // the post is mined and returns the snapshot that drops the
                // leaver: the block queued during it posts nothing more
                expect(await send.release()).to.equal(null);
                expect(
                    (await posts.resultsWait(startedBefore + 1)).at(-1)
                ).to.equal("posted");
                await h.event.waitUntilLeftChannel(leaver.index);
                // absence window: a queued post would have started by now
                await sleep(2_000);
                expect(await posts.started()).to.equal(startedBefore + 1);
                expect(await leaverNonce()).to.equal(nonceBefore + 1);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.not.include(leaver.address);
                expect(await disputes.submissions()).to.deep.equal([]);
            } finally {
                await send.release();
                await posts.restore();
            }
        });

        it("U72: a chain refusal of the exit's snapshot post reaches the leave's logger with its custom error and is not fatal: the next finalized block posts again", async function () {
            const h = TestSession.getHarness();
            const { leaver, remainingPeerIndices, posts, disputes } =
                await stageInboundBlockedExit(h);
            const logs = await recordLeaveChannelLogs(h, leaver);
            const refused = {
                message: "The chain refused the exit snapshot post",
                meta: [{ refusal: "RaceConditionPendingInboundNotConsumed" }]
            };
            try {
                const before = (await posts.results()).length;
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                expect((await posts.resultsWait(before + 1)).at(-1)).to.equal(
                    "RaceConditionPendingInboundNotConsumed"
                );
                await waitFor(
                    async () => (await logs.entries()).length >= 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await logs.entries()).to.deep.equal([refused]);

                // the refusal is not fatal: the next finalized block posts again
                await h.transition.advanceState({
                    waitForPeers: remainingPeerIndices
                });
                expect((await posts.resultsWait(before + 2)).at(-1)).to.equal(
                    "RaceConditionPendingInboundNotConsumed"
                );
                await waitFor(
                    async () => (await logs.entries()).length >= 2,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await logs.entries()).to.deep.equal([refused, refused]);
                expect(await disputes.submissions()).to.deep.equal([]);
                // no detached error: settleDetached throws on one
                await TestSession.settleDetached();
            } finally {
                await logs.restore();
                await posts.restore();
            }
        });

        it("U72: an exit post that fails with an error that is no chain refusal is a fatal runtime error", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const leaver = h.getPeer(1);
            await h
                .control(leaver)
                .stub.failStateSnapshotPost("error")
                .request();
            const posts = await recordSnapshotPostWaitResults(h, leaver);
            const exit = exitOnLeaveTurn(leaver);
            try {
                await leaver.p2pInstance.p2pSigner.leaveChannel();
                await h.transition.keepAuthoringUntil({
                    until: () => exit() !== undefined,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 6
                });
                await exit();
                // the finalized exit block makes the leaver post, and that
                // post fails with no chain refusal
                expect((await posts.resultsWait(1))[0]).to.equal("failed");
                await TestSession.settleDetached({
                    expectedErrorIncludes: UNEXPECTED_SNAPSHOT_POST_FAILURE
                });
                expect(leaver.eventSpies.onLeftChannel?.called).to.equal(false);
            } finally {
                await posts.restore();
                await h
                    .control(leaver)
                    .stub.restoreStateSnapshotPost()
                    .request();
            }
        });

        it("U72: a leave of a pending join the chain has not shown re-arms the leave watchdog at each expiry with no dispute, and the join's expiry ends the leave and cancels the watchdog", async function () {
            const h = TestSession.getHarness();
            // the watchdog expires at least once within the join's authorization
            const watchdogMs = 3_000;
            const prepared = await prepareJoinWithAuthorization(h, 15, {
                LEAVE_CHANNEL_WATCHDOG_MS: watchdogMs
            });
            const joiner = prepared.joiner;
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                joiner.index
            );
            const tasks = await h.rpcStub.recordScheduledTasks(joiner.index);
            const restore = await h.rpcStub.failMembershipSubmissionUncertain(
                joiner.index,
                "joinChannel"
            );
            const watchdogDelays = async () =>
                (await tasks.tasks())
                    .filter(
                        (task) => task.taskName === "channel leave watchdog"
                    )
                    .map((task) => task.delayMs);
            try {
                expect(
                    await joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);
                await joiner.p2pInstance.p2pSigner.leaveChannel();

                // the founders keep authoring while the watchdog armed by the
                // leave expires and a replacement is armed
                await h.transition.keepAuthoringUntil({
                    until: async () => (await watchdogDelays()).length >= 2,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 6
                });
                expect((await watchdogDelays()).slice(0, 2)).to.deep.equal([
                    watchdogMs,
                    watchdogMs
                ]);
                expect(await recorder.submissions()).to.deep.equal([]);
                expect(
                    await isJoinPending(h, h.getPeer(joiner.index))
                ).to.equal(true);
                expect(joiner.eventSpies.onLeftChannel?.called).to.equal(false);

                // the join ends at its authorization deadline, and the leave with it
                await Promise.all([
                    chainBlockPastWait(h, prepared.joinDeadline),
                    h.transition.keepAuthoringUntil({
                        until: () =>
                            joiner.eventSpies.onLeftChannel?.called === true,
                        waitForPeers: [0, 1, 2],
                        maximumBlocks: 20
                    })
                ]);
                await h.event.waitUntilLeftChannel(joiner.index);
                expect(
                    await h.control(joiner).query.getStatus().request()
                ).to.equal(Status.SYNCED);
                expect(
                    await h.execOnHost(
                        h.getPeer(joiner.index),
                        (sm) =>
                            Reflect.get(sm.leaveChannelService, "watchdog") ===
                            undefined
                    )
                ).to.equal(true);
                expect(await recorder.submissions()).to.deep.equal([]);
            } finally {
                await restore();
                await tasks.restore();
                await recorder.restore();
            }
        });

        it("U72: a reduction that replaces the fork of an exit block the application authored with no leave call by a state that still seats the leaver restarts the exit there as a requested leave: its leave turn comes, self-removal stays set and its exit settles", async function () {
            const h = TestSession.getHarness();
            const { leaver, forkId, exit } =
                await stageExitReplacedBySeatingFork(h);
            const leaverQuery = h.control(leaver).query;
            const successorForkId = await leaverQuery.getForkId().request();
            expect(successorForkId).to.not.equal(forkId);
            expect(await leaverQuery.getParticipants().request()).to.include(
                leaver.address
            );
            await h.event.waitUntilLeaveState(leaver.index, "isLeaveRequested");
            expect(
                await leaverQuery.getLeaveChannelState().request()
            ).to.deep.include({
                forkId: successorForkId,
                isLeaveRequested: true,
                isExitBlockCommitted: false
            });
            expect(await readForceExit(h, leaver)).to.equal(true);

            // the requested leave offers the leaver's next turn on the new fork
            await h.transition.keepAuthoringUntil({
                until: () => exit() !== undefined,
                waitForPeers: [leaver.index, 2],
                maximumBlocks: 6
            });
            expect(leaver.eventSpies.onLeaveTurn?.callCount).to.equal(1);
            await exit();
            await h.event.waitUntilLeftChannel(leaver.index);
            const participants = await h.channelManager.getParticipants(
                h.channelId
            );
            expect(participants).to.not.include(leaver.address);
            expect(participants).to.include(h.getPeer(2).address);
            expect(await readForceExit(h, leaver)).to.equal(true);
        });

        it("U72: a lone leaver whose self-removal dispute leaves no participant posts that reduced fork once after installing it, and that post closes the channel and settles the leave", async function () {
            const h = TestSession.getHarness();
            const { lone, expireWatchdog } =
                await stageLoneLeaverSelfRemoval(h);
            const posts = await recordSnapshotPostWaitResults(h, lone);
            const disputes = await h.rpcStub.recordDisputeSubmissions(
                lone.index,
                { forward: true }
            );
            try {
                await expireWatchdog();
                await h.event.waitUntilLeftChannel(lone.index);
                expect(await posts.resultsWait(1)).to.deep.equal(["posted"]);
                expect(await posts.started()).to.equal(1);
                const [submission] = await disputes.submissions();
                expect(
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .selfRemoval
                ).to.equal(true);
                expect(await disputes.submissions()).to.have.length(1);
                expect(
                    (await h.channelManager.isChannelOpen(h.channelId))[0]
                ).to.equal(false);
            } finally {
                await posts.restore();
                await disputes.restore();
            }
        });

        it("U72: two leavers whose self-removal disputes form a non-final reduction that leaves no participant: a leaver's post closes the channel, the reducer's later adoption post of that fork is refused with RaceConditionGenesisTimestampNotAvailable and not retried, and each leaver leaves once with no abort", async function () {
            const h = TestSession.getHarness();
            const staged = await stageLeavePostClosingBeforeAdoption(h);
            const { reducer, leaver } = staged;
            try {
                expect(await staged.leaverPosts.resultsWait(1)).to.deep.equal([
                    "posted"
                ]);
                expect(await staged.adoption.release()).to.equal(
                    "RaceConditionGenesisTimestampNotAvailable"
                );
                expect(
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId
                ).to.equal(ethers.ZeroHash);
                // the reducer's own exit post runs after the close: it sends nothing
                await staged.reducerPosts.releaseStarts();
                const reducerResults = await staged.reducerPosts.resultsWait(1);
                expect(reducerResults).to.deep.equal(
                    reducerResults.map(() => "no-op")
                );
                for (const peer of [reducer, leaver])
                    await h.event.waitUntilLeftChannel(peer.index);
                await TestSession.settleDetached();
                expect(
                    await staged.adoptionRetries(),
                    "no adoption retry"
                ).to.equal(0);
                for (const peer of [reducer, leaver]) {
                    expect(
                        h.event.getEventCallCount(peer.index, "onLeftChannel")
                    ).to.equal(1);
                    expect(
                        h.event.getEventCallCount(peer.index, "onAbort")
                    ).to.equal(0);
                }
                expect(staged.hostErrors).to.deep.equal([]);
            } finally {
                await staged.restore();
            }
        });

        it("U72: a leaver's exit post of a non-final reduction that leaves no participant, held at its send while the reducer's adoption post closes the channel, is refused with RaceConditionGenesisTimestampNotAvailable, logged as a chain refusal and not fatal, and the leaver leaves once", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAdoptionClosingBeforeLeavePost(h);
            const { reducer, leaver } = staged;
            const refusal = "RaceConditionGenesisTimestampNotAvailable";
            try {
                expect(await staged.releaseLeaverPost()).to.equal(refusal);
                expect(await staged.leaverPosts.resultsWait(1)).to.deep.equal([
                    refusal
                ]);
                await waitFor(
                    async () => (await staged.leaverRefusals()).length > 0,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await staged.leaverRefusals()).to.deep.equal([
                    [{ refusal }]
                ]);
                await staged.reducerPosts.releaseStarts();
                for (const peer of [reducer, leaver])
                    await h.event.waitUntilLeftChannel(peer.index);
                await TestSession.settleDetached();
                expect(
                    h.event.getEventCallCount(leaver.index, "onLeftChannel")
                ).to.equal(1);
                expect(staged.hostErrors).to.deep.equal([]);
            } finally {
                await staged.restore();
            }
        });
        it("U72: two leavers whose self-removal disputes form a non-final reduction that leaves no participant: a reduced result committed while the leaver's install-time post runs queues a post that the leaver's membership check sends after it, and that post closes the channel while the reducer's adoption and its retry fail; each leaver leaves once with no abort", async function () {
            const h = TestSession.getHarness();
            const staged = await stageCommitCheckQueuedBehindLeaverPost(h);
            const { reducer, leaver } = staged;
            try {
                await staged.leaverPosts.releaseResults();
                expect(await staged.leaverPosts.resultsWait(2)).to.deep.equal([
                    "no-op",
                    "posted"
                ]);
                expect(
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId
                ).to.equal(ethers.ZeroHash);
                expect(
                    (await h.channelManager.isChannelOpen(h.channelId))[0]
                ).to.equal(false);
                // the reducer's own exit post runs after the close: it sends nothing
                await staged.reducerPosts.releaseStarts();
                const reducerResults = await staged.reducerPosts.resultsWait(1);
                expect(reducerResults).to.deep.equal(
                    reducerResults.map(() => "no-op")
                );
                // the leaver's held reduce is sent only after the close
                await staged.leaverAttempts.release();
                for (const peer of [reducer, leaver])
                    await h.event.waitUntilLeftChannel(peer.index);
                await TestSession.settleDetached();
                expect(await staged.adoptionPosts()).to.equal(2);
                expect(await staged.adoptionRetries()).to.equal(1);
                for (const peer of [reducer, leaver]) {
                    expect(
                        h.event.getEventCallCount(peer.index, "onLeftChannel")
                    ).to.equal(1);
                    expect(
                        h.event.getEventCallCount(peer.index, "onAbort")
                    ).to.equal(0);
                }
                expect(staged.unexpectedHostErrors()).to.deep.equal([]);
            } finally {
                await staged.restore();
            }
        });
    });

    describe("latest-state spectate request", function () {
        it("U73: a latest-state request to a responder past its initial load that has not installed the chain's fork → refused for that fork, requester not blacklisted", async function () {
            const result = await latestRequestToResponderBehindChainFork(
                TestSession.getHarness()
            );

            // premise: the responder's own fork is the source fork, and it
            // holds no genesis of the chain's successor
            expect(result.responderForkId).to.equal(result.sourceForkId);
            expect(result.isSuccessorInstalled).to.equal(false);
            // The responder serves the fork it derives from the chain, not its
            // own fork; without that fork's genesis it refuses.
            expect(result.refusal).to.equal(
                `No genesis snapshot found for fork ${result.successor}`
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
                await waitForJoinChecks(h, joiner);
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

        it("RO2: the block bound passing while the deadline awaits membership requests only one dispute", async function () {
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
                // the join checks run one at a time: the block bound's check
                // waits behind the held deadline check
                expect(await requests.requests()).to.have.length(0);
                await read.release();
                await running;
                await waitFor(
                    async () => (await recorder.submissions()).length === 1
                );
                expect(
                    (await readForceJoinBounds(h, joiner)).disputeStarted
                ).to.equal(true);
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
                await waitForJoinChecks(h, joiner);
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
                await waitForJoinChecks(h, joiner);
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

        it("disposing a joiner while its force-join check is held at its membership read and another check waits behind it submits no dispute and emits no membership event", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
            const joiner = h.getPeer(prepared.joiner.index);
            const spies = prepared.joiner.eventSpies;
            for (const index of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(index);
                // only the joiner could open a dispute window on the fork
                await h.rpcStub.suppressTimeoutCheck(index);
            }
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            await waitFor(async () => (await deadline.heldCount()) === 1);
            // the disposal below releases the held read
            const read = await holdForceJoinMembershipRead(h, joiner.index, {
                releaseOnDispose: true
            });
            await deadline.release(true);
            await waitFor(read.entered);
            // a committed block counted toward the bound queues one more check
            const bounds = await authorUntilForceJoinCountingStarted(
                h,
                joiner.index,
                [0, 1, 2]
            );
            expect(await isJoinCheckQueued(h, joiner)).to.equal(true);
            const before = {
                disputes: spies.onInitiatingDispute?.callCount ?? 0,
                left: spies.onLeftChannel?.callCount ?? 0,
                statusChanges: spies.onStatusChanged?.callCount ?? 0
            };

            await prepared.joiner.p2pInstance.dispose();
            // absence window: the released check and the queued one run in
            // the disposed runtime; a dispute they sent lands within it
            await sleep(bounds.timeConfig.agreementTime * 2 * 1000);

            expect({
                disputes: spies.onInitiatingDispute?.callCount ?? 0,
                left: spies.onLeftChannel?.callCount ?? 0,
                statusChanges: spies.onStatusChanged?.callCount ?? 0
            }).to.deep.equal(before);
            expect(
                Number(
                    await h.channelManager.getDisputeWindowCreationTimestamp(
                        h.channelId,
                        prepared.expectedForkId
                    )
                )
            ).to.equal(0);
        });

        it("disposing a joiner while its force-join deadline setup is held at its participant-count read arms no join timer once the setup continues", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(4, {
                // the retained inline host stays readable after disposal
                configOverrides: { RUN_SDK_IN_THREAD: false }
            });
            const joiner = prepared.joiner;
            const endpoint = runtimeEndpointFor(joiner.p2pInstance);
            // record-only scheduling probe: every task still runs as scheduled
            endpoint.stub.stubRecordScheduledTasks();
            const read = holdForceJoinDeadlineParticipantRead(endpoint.sm);
            try {
                expect(
                    await joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                // the observed join's deadline setup read the participants
                await waitFor(
                    async () => read.isEntered(),
                    h.event.protocolEventTimeoutMs()
                );

                await joiner.p2pInstance.dispose();
                await waitFor(
                    async () => endpoint.sm.isDisposed,
                    h.event.protocolEventTimeoutMs()
                );
                const tasksAtDisposal =
                    endpoint.stub.getRecordedScheduledTasks().tasks.length;
                read.release();
                await Reflect.get(endpoint.sm.channelJoinService, "checks");

                expect(
                    endpoint.stub
                        .getRecordedScheduledTasks()
                        .tasks.slice(tasksAtDisposal)
                        .map((task) => task.taskName)
                        .filter((name) =>
                            (JOIN_TIMER_NAMES as readonly string[]).includes(
                                name
                            )
                        )
                ).to.deep.equal([]);
            } finally {
                read.release();
                endpoint.stub.restoreRecordScheduledTasks();
            }
        });
    });

    describe("own-join observation and join authorization expiry", function () {
        it("U75a: a delayed on-chain observation starts the deadline and the counting grace at observation, not at submission", async function () {
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

        it("U75b: an uncertain join that never reaches the chain → the join stays pending until the chain passes its authorization deadline, then the runtime leaves to SYNCED", async function () {
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
                const joiner = h.getPeer(prepared.joiner.index);
                const joinerQuery = h.control(joiner).query;
                expect(await isJoinPending(h, joiner)).to.equal(true);
                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.PENDING_PARTICIPANT
                );

                await chainBlockPastWait(h, prepared.joinDeadline);
                await h.event.waitUntilLeftChannel(joiner.index);
                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.SYNCED
                );
                expect(await isJoinPending(h, joiner)).to.equal(false);
            } finally {
                await restore();
            }
        });

        it("U75c: a pending joiner whose join never lands → its leave waits for the join and settles back to SYNCED once the authorization expired on chain", async function () {
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
                await joiner.p2pInstance.p2pSigner.leaveChannel();
                // the leave waits for the join
                expect(joiner.eventSpies.onLeftChannel?.called).to.equal(false);

                // The founders keep authoring through the wait.
                await Promise.all([
                    chainBlockPastWait(h, prepared.joinDeadline),
                    h.transition.keepAuthoringUntil({
                        until: () =>
                            joiner.eventSpies.onLeftChannel?.called === true,
                        waitForPeers: [0, 1, 2],
                        maximumBlocks: 20
                    })
                ]);
                await h.event.waitUntilLeftChannel(joiner.index);

                expect(
                    await h.control(joiner).query.getStatus().request()
                ).to.equal(Status.SYNCED);
                expect(
                    await readTrackedJoin(h, h.getPeer(joiner.index))
                ).to.equal(null);
                expect(await recorder.submissions()).to.deep.equal([]);
            } finally {
                await restore();
                await recorder.restore();
            }
        });

        it("U75d: a join observed during the leave's join wait turns the leave into a member's leave", async function () {
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
            await joiner.p2pInstance.p2pSigner.leaveChannel();
            expect(
                (await readForceJoinBounds(h, h.getPeer(joiner.index)))
                    .countingStartsAt
            ).to.equal(null);

            await held.release({ replay: true });

            // the observed join makes it a member's leave
            await waitFor(
                async () =>
                    (await readForceJoinBounds(h, h.getPeer(joiner.index)))
                        .countingStartsAt !== null
            );
            expect(
                await h.control(joiner).query.getLeaveChannelState().request()
            ).to.deep.include({ isLeaveRequested: true });
            expect(joiner.eventSpies.onLeftChannel?.called).to.equal(false);
            await joiner.p2pInstance.dispose();
        });

        it("U75e: a leaving joiner whose landed join a founder's timeout dispute reduces away while the chain still lists it → once the chain drops it, its force-join check starts no dispute and lowers it to SYNCED with one onLeftChannel", async function () {
            const h = TestSession.getHarness();
            // engineer decision (Luka, 2026-10-12): 6s, not the staging's 4s.
            // The leaving joiner audits the founder's timeout dispute before
            // its self-removal; under load that path can outlast 4 s.
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(4, {
                timeConfig: { evidenceTime: 6 }
            });
            const joiner = prepared.joiner;
            const joinerQuery = h.control(joiner).query;
            // The founders omit the join, so the joiner stays pending.
            for (const peerIndex of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(peerIndex);
            }
            // One founder times out the idle writer: the leaving joiner
            // audits one dispute, not one per founder, before its
            // self-removal must land within the evidence period.
            const nextToWrite = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            const [, ...otherFounders] = [0, 1, 2].filter(
                (index) =>
                    !addressesEqual(h.getPeer(index).address, nextToWrite)
            );
            for (const index of otherFounders)
                await h.rpcStub.suppressTimeoutCheck(index);
            // The force-join deadline is held when armed: the joiner's own
            // force-join dispute cannot start, and the deadline is passed
            // below only once the chain dropped the join.
            const deadline = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "force join deadline"
            );
            // Every snapshot post parks, so the chain still lists the joiner
            // when it installs the reduction genesis that drops it.
            const posts = await Promise.all(
                h.peers.map((peer) =>
                    h.rpcStub.holdSnapshotPostSend(peer.index)
                )
            );
            let isDeadlineReleased = false;
            let requests:
                | Awaited<ReturnType<typeof observeDisputeRequests>>
                | undefined;
            try {
                expect(
                    await joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(true);
                await joiner.p2pInstance.p2pSigner.leaveChannel();
                const disputedForkId = await joinerQuery.getForkId().request();
                // No block is authored after the join: a founder's
                // participant-timeout dispute opens the window, and the
                // leaving joiner answers it at once with its self-removal
                // dispute. The leave watchdog skips a join in progress.
                await waitFor(() =>
                    joinerQuery.didIDispute(disputedForkId).request()
                );
                expect(
                    (await readForceJoinBounds(h, h.getPeer(joiner.index)))
                        .disputeStarted
                ).to.equal(false);
                const founderDisputes = await Promise.all(
                    [0, 1, 2].map((index) =>
                        h
                            .control(h.getPeer(index))
                            .query.didIDispute(disputedForkId)
                            .request()
                    )
                );
                expect(founderDisputes).to.include(true);
                // Every peer leaves the disputed fork, not only the joiner: a
                // founder whose reduction has not run yet would author the next
                // block on the disputed fork, and the others drop it.
                await h.assert.sync.forkChangedWait({
                    originalForkId: disputedForkId,
                    honestPeerIndices: h.peers.map((peer) => peer.index)
                });
                const reducedForkId = await joinerQuery.getForkId().request();
                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.PENDING_PARTICIPANT
                );
                expect(
                    await h.channelManager.getPendingParticipants(h.channelId)
                ).to.include(joiner.address);
                requests = await observeDisputeRequests(h, joiner.index);

                // The founders keep authoring, so no later dispute installs
                // another state, until the released post drops the joiner
                // on chain; too few blocks for the force-join block bound.
                await Promise.all(posts.map((post) => post.release()));
                await h.transition.keepAuthoringUntil({
                    until: async () =>
                        !(
                            await joinerQuery
                                .getOnChainParticipantUnion()
                                .request()
                        ).includes(joiner.address),
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 4
                });
                expect(joiner.eventSpies.onLeftChannel?.called).to.equal(false);
                // the force-join check now runs and finds the join dropped
                isDeadlineReleased = true;
                await deadline.release(true);
                await h.transition.keepAuthoringUntil({
                    until: () =>
                        joiner.eventSpies.onLeftChannel?.called === true,
                    waitForPeers: [0, 1, 2],
                    maximumBlocks: 8
                });
                await h.event.waitUntilLeftChannel(joiner.index);

                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.SYNCED
                );
                expect(await joinerQuery.getForkId().request()).to.equal(
                    reducedForkId
                );
                expect(
                    await joinerQuery.getOnChainParticipantUnion().request()
                ).to.not.include(joiner.address);
                expect(joiner.eventSpies.onLeftChannel?.callCount).to.equal(1);
                expect(
                    await readTrackedJoin(h, h.getPeer(joiner.index))
                ).to.equal(null);
                expect(await requests.requests()).to.deep.equal([]);
            } finally {
                if (!isDeadlineReleased) await deadline.release(false);
                await Promise.all(posts.map((post) => post.release()));
                await requests?.restore();
            }
        });

        it("U75f: a pending joiner whose uncertain join can still land handles a snapshot event that does not list it → it stays PENDING_PARTICIPANT with its join open", async function () {
            const h = TestSession.getHarness();
            // the authorization stays open through the test
            const prepared = await prepareJoinWithAuthorization(h, 120);
            const joiner = prepared.joiner;
            const joinerQuery = h.control(joiner).query;
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
                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.PENDING_PARTICIPANT
                );
                const handled = h.event.getEventCallCount(
                    joiner.index,
                    "onStateSnapshotUpdated"
                );

                // a founder's snapshot post: the chain lists no pending join
                await h.transition.postSnapshotWait({ peerIndex: 0 });
                await h.event.waitForEventCounts(
                    "onStateSnapshotUpdated",
                    [{ peerId: joiner.index, expectedCount: handled + 1 }],
                    undefined,
                    { mode: "atLeast" }
                );

                expect(await joinerQuery.getStatus().request()).to.equal(
                    Status.PENDING_PARTICIPANT
                );
                expect(
                    await isJoinPending(h, h.getPeer(joiner.index))
                ).to.equal(true);
            } finally {
                await restore();
            }
        });

        it("U75g: a finally refused first join emits onLeftChannel once and does not abort; a later join of the same runtime refused for its expired authorization emits its onLeftChannel before onAbort, each once", async function () {
            const h = TestSession.getHarness();
            const prepared = await prepareJoinWithAuthorization(h, 2);
            const joiner = prepared.joiner;
            const spies = joiner.eventSpies;
            const signer = joiner.p2pInstance.p2pSigner;
            const join = () =>
                signer.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            // the first submission's receipt fails; later ones run for real
            await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel", {
                once: true
            });

            // a proven failure with the snapshot at its pin: final, no race
            expect(await join()).to.equal(false);
            await h.event.waitUntilLeftChannel(joiner.index);
            expect(spies.onLeftChannel?.callCount).to.equal(1);
            expect(spies.onAbort?.called ?? false).to.equal(false);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.SYNCED);

            // the same runtime joins again once the authorization expired
            await chainBlockPastWait(h, prepared.joinDeadline);
            let expired: unknown;
            try {
                await h.channelManager
                    .connect(joiner.signer)
                    .joinChannel.staticCall(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    );
                expect.fail("expected the expired join to revert");
            } catch (error) {
                expired = error;
            }
            expectDecodedError(
                expired,
                "RaceConditionJoinChannelExpired",
                "the second join must meet the authorization refusal"
            );
            // the abort disposes the runtime, so the call may also reject
            expect(await join().catch(() => false)).to.equal(false);
            await waitFor(
                async () => spies.onAbort?.called === true,
                h.event.protocolEventTimeoutMs()
            );
            await h.event.waitUntilLeftChannel(joiner.index, 1);

            expect(spies.onLeftChannel?.callCount).to.equal(2);
            expect(spies.onAbort?.callCount).to.equal(1);
            expect(
                spies
                    .onLeftChannel!.getCall(1)
                    .calledBefore(spies.onAbort!.getCall(0))
            ).to.equal(true);
        });

        it("U75h: a join authorization expiry timer that fires while the joiner's clock is still at or before the deadline arms the expiry timer again → once the chain passes the deadline the unlanded join ends SYNCED with one onLeftChannel", async function () {
            const h = TestSession.getHarness();
            const prepared = await prepareJoinWithAuthorization(h, 15);
            const joiner = h.getPeer(prepared.joiner.index);
            const control = h.control(joiner);
            // record-only: the expiry timer the early check arms again
            await control.stub.stubRecordScheduledTasks().request();
            // the first expiry timer is held when armed and fired early below
            const expiry = await h.rpcStub.holdScheduledTasks(
                joiner.index,
                "join authorization expiry"
            );
            const restore = await h.rpcStub.failMembershipSubmissionUncertain(
                joiner.index,
                "joinChannel"
            );
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);
                expect(await expiry.heldCount()).to.equal(1);

                expect(await expiry.runHeld()).to.deep.equal({
                    ran: 1,
                    errors: []
                });
                await waitForJoinChecks(h, joiner);
                // the check ran with the joiner's clock not past the deadline
                expect(
                    await control.query.getClockTimeInSeconds().request()
                ).to.be.at.most(prepared.joinDeadline);
                const rearmed = (
                    await control.stub.getRecordedScheduledTasks().request()
                ).tasks.filter(
                    (task) => task.taskName === "join authorization expiry"
                );
                expect(rearmed.length).to.equal(1);
                expect(rearmed[0].delayMs).to.be.at.least(1000);
                expect(await isJoinPending(h, joiner)).to.equal(true);
                expect(
                    prepared.joiner.eventSpies.onLeftChannel?.called
                ).to.not.equal(true);

                await chainBlockPastWait(h, prepared.joinDeadline);
                await h.event.waitUntilLeftChannel(joiner.index);
                expect(await control.query.getStatus().request()).to.equal(
                    Status.SYNCED
                );
                expect(await isJoinPending(h, joiner)).to.equal(false);
                expect(
                    prepared.joiner.eventSpies.onLeftChannel?.callCount
                ).to.equal(1);
            } finally {
                await restore();
                await expiry.release(false);
                await control.stub.restoreRecordScheduledTasks().request();
            }
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

    describe("lobby leave during negotiation handoff", function () {
        const waitForBothChannelsOpened = async (
            h: ReturnType<typeof TestSession.getHarness>
        ) =>
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            h.peers.map((peer) =>
                                h.control(peer).query.getChannelId().request()
                            )
                        )
                    ).every((channelId) => channelId !== ethers.ZeroHash),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
            );

        it("U130: a leave of another topic during the handoff → the join still rematches on its own topic", async function () {
            const h = TestSession.getHarness();
            await h.setup(2, { autoConnect: false });
            const topic = ethers.id("unit-lobby-leave-other-topic");
            const release = await h.network.joinLobbyHeldAtHandoff(
                [0, 1],
                topic
            );
            try {
                for (const peer of h.peers) {
                    await h
                        .control(peer)
                        .network.leaveLobby(ethers.id("unit-lobby-other"))
                        .request();
                }
                await release();
                // the rematch pairs the two peers again and opens a channel
                await waitForBothChannelsOpened(h);
            } finally {
                await release();
                await h.network.leaveLobby([0, 1], topic);
            }
            await TestSession.settleDetached();
        });

        it("U130: a new join after a leave during the handoff → its failed negotiation rematches again", async function () {
            const h = TestSession.getHarness();
            await h.setup(2, { autoConnect: false });
            const topic = ethers.id("unit-lobby-rejoin-after-leave");
            const first = await h.network.joinLobbyHeldAtHandoff([0, 1], topic);
            // the failed negotiation ends both joins, so both leaves report true
            expect(
                await h.network.leaveLobbyAtHeldHandoff([0, 1], topic, first)
            ).to.deep.equal([true, true]);
            await TestSession.settleDetached();
            const second = await h.network.joinLobbyHeldAtHandoff(
                [0, 1],
                topic
            );
            try {
                await second();
                // the rematch pairs the two peers again and opens a channel
                await waitForBothChannelsOpened(h);
            } finally {
                await second();
                await h.network.leaveLobby([0, 1], topic);
            }
            await TestSession.settleDetached();
        });
    });
});
