import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { sleep } from "@/utils";
import {
    chainBlockPastWait,
    prepareJoinWithAuthorization
} from "@test/fixtures/BotConnectionFixesStaging";
import {
    type HeldForceJoinMembershipRead,
    holdForceJoinMembershipRead,
    readTrackedJoin,
    waitForJoinChecks
} from "@test/fixtures/ForceJoinCountingStaging";
import {
    chainJoinAmounts,
    countJoinSignatureRequests,
    joinFullChannel,
    landPendingJoin,
    moveChainSnapshot,
    raceJoinPastTwoLandingJoins,
    refuseHeldJoinsOnSnapshotMoves,
    refuseOneThresholdCountersignature,
    remoteThresholdPeerIndices,
    waitForHeldJoins
} from "@test/fixtures/JoinSnapshotRetryStaging";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Plan 35, E42: the join transaction's snapshot pin, through the joiner's SDK
 * join. A real snapshot update landing while the prepared join waits at its
 * send makes the pin stale; with no update the pin matches and the joiner is
 * admitted.
 */
describe("E2E: join snapshot guard", function () {
    it("E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted", async function () {
        const h = TestSession.getHarness();
        const {
            joiner,
            stateSnapshot: snapshotAtPreparation,
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        } = await h.scenario.syncSpectatorAndPrepareJoin();
        expect(expectedSnapshotHash).to.equal(
            StateSnapshot.from(snapshotAtPreparation).hash
        );

        // no snapshot update lands between preparation and execution
        expect(
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).hash
        ).to.equal(expectedSnapshotHash);
        const joined = await joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );

        expect(joined).to.equal(true);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );

        // the next block consumes the join: the joiner participates
        await h.assert.storage.honestPeersObserveInboundMessageWait({
            peerIndices: [0, 1, 2]
        });
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2]
        });
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
        expect(
            await h.control(joiner).query.getParticipants().request()
        ).to.include(joiner.address);
    });

    it("E42: a join prepared against snapshot S and held at its send while a real snapshot update lands is prepared again once against the stored new snapshot, and the joiner is admitted", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitForHeldJoins(h, joiner.index, 1);

        const current = await moveChainSnapshot(h);
        expect(current).to.not.equal(expectedSnapshotHash);
        await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
        // the stale pin reverts; the join is prepared again and resubmitted
        await waitForHeldJoins(h, joiner.index, 2);
        await releaseSubmission();

        expect(await join).to.equal(true);
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);

        // the stale pin itself still reverts on the chain
        let revert: unknown;
        try {
            await h.channelManager
                .connect(joiner.signer)
                .joinChannel.staticCall(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                );
            expect.fail("expected the stale join to revert");
        } catch (error) {
            revert = error;
        }
        expectDecodedError(
            revert,
            "RaceConditionJoinChannelSnapshotMismatch",
            "the join must revert on its stale snapshot pin"
        );
    });

    it("a connect's join whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and the joiner is admitted", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitForHeldJoins(h, joiner.index, 1);

        await moveChainSnapshot(h);
        await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
        // the first submission reverts on its stale pin; the retry is submitted
        await waitForHeldJoins(h, joiner.index, 2);
        await releaseAll();

        expect(await join).to.equal(true);
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
    });

    it("a connect's join whose snapshot moves again before its retry lands is collected again and lands on its third submission: the joiner is admitted with no abort", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);

        // the first submission and its retry are each refused on a stale pin
        await refuseHeldJoinsOnSnapshotMoves(h, joiner.index, 2);
        await waitForHeldJoins(h, joiner.index, 3);
        // later submissions stay held: the count read below is the total
        await h.rpcStub.releaseOneMembershipSubmission(joiner.index);

        expect(await join).to.equal(true);
        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(3);
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
        await releaseAll();
    });

    it("a connect's join refused on a moved snapshot at every submission stops retrying at the channel's maximum participant count: after that many retries connect returns false, the joiner aborts, and no further confirmation is collected", async function () {
        const h = TestSession.getHarness();
        // the smallest channel that seats the three founders and the joiner:
        // at most four retries
        const joiner = await h.scenario.syncSpectator(4, {
            maxChannelParticipants: 4
        });
        await h.rpcStub.holdMembershipSubmission(joiner.index, "joinChannel");
        const countersigned = await countJoinSignatureRequests(h, [0, 1, 2]);
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);

        // the first submission and its four retries are each refused on a stale pin
        await refuseHeldJoinsOnSnapshotMoves(h, joiner.index, 5);

        expect(await join).to.equal(false);
        await waitFor(
            async () => joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        // five collections (the first and four retries), each asking every
        // founder once: none after the fifth refusal
        expect(await countersigned()).to.equal(15);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a connect's join that fails while the snapshot stays put is not retried: the joiner is back to SYNCED and not admitted", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel");

        expect(
            await joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true
            })
        ).to.equal(false);

        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        await h.event.waitUntilLeftChannel(joiner.index);
        expect(joiner.eventSpies.onLeftChannel?.callCount).to.equal(1);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a join whose snapshot moves to one this joiner does not store is not prepared again: the join fails and the joiner aborts", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        // blind to gossip: the joiner never stores the block the new snapshot comes from
        await h.control(joiner).stub.stubDropNetworkConfirmations().request();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitForHeldJoins(h, joiner.index, 1);

        await moveChainSnapshot(h, { isChainOnly: true });
        // a pending joiner that sees an unknown snapshot without itself aborts,
        // which may dispose the runtime before this release reaches it
        await h.rpcStub
            .releaseOneMembershipSubmission(joiner.index)
            .catch(() => 0);

        // the abort disposes the runtime, so the call may also reject
        expect(await join.catch(() => false)).to.equal(false);
        await waitFor(
            async () => joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);
        await releaseAll().catch(() => undefined);
    });

    it("a top-up whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and lands", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        const topUp = participant.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true, balance: { amount: 5, data: "0x" } }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        topUp.catch(() => undefined);
        await waitForHeldJoins(h, participant.index, 1);

        await moveChainSnapshot(h);
        await h.rpcStub.releaseOneMembershipSubmission(participant.index);
        // the stale pin reverts; the top-up is prepared again and resubmitted
        await waitForHeldJoins(h, participant.index, 2);
        await releaseAll();

        expect(await topUp).to.equal(true);
        // the chain credited the requested amount exactly once
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([5n]);
    });

    it("a connect's join whose fresh confirmation for its retry cannot be collected returns false with no second submission, and the joiner stays SYNCED", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitForHeldJoins(h, joiner.index, 1);

        await moveChainSnapshot(h);
        // one threshold member refuses the retry's countersignature
        await refuseOneThresholdCountersignature(h, joiner.index);
        await h.rpcStub.releaseOneMembershipSubmission(joiner.index);

        expect(await join).to.equal(false);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        // the logical join ended once: one membership-end event
        await h.event.waitUntilLeftChannel(joiner.index);
        expect(joiner.eventSpies.onLeftChannel?.callCount).to.equal(1);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        await releaseAll();
    });

    it("a top-up whose fresh confirmation for its retry cannot be collected returns false with no second submission, and the participant keeps participating", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        const topUp = participant.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true, balance: { amount: 5, data: "0x" } }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        topUp.catch(() => undefined);
        await waitForHeldJoins(h, participant.index, 1);

        await moveChainSnapshot(h);
        // one threshold member refuses the retry's countersignature
        await refuseOneThresholdCountersignature(h, participant.index);
        await h.rpcStub.releaseOneMembershipSubmission(participant.index);

        expect(await topUp).to.equal(false);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        await releaseAll();
    });

    it("a join whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it keeps PENDING_PARTICIPANT after one submission", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        await moveChainSnapshot(h);
        await h.rpcStub.failMembershipSubmissionUncertain(
            joiner.index,
            "joinChannel"
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            [0, 1, 2]
        );

        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            )
        ).to.equal(false);

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        expect(await signatureRequests()).to.equal(0);
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a top-up whose snapshot moves again before its retry lands is collected again and lands on its third submission: the amount credited once and the participation kept", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        const topUp = participant.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true, balance: { amount: 5, data: "0x" } }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        topUp.catch(() => undefined);

        // the first submission and its retry are each refused on a stale pin
        await refuseHeldJoinsOnSnapshotMoves(h, participant.index, 2);
        await waitForHeldJoins(h, participant.index, 3);
        // later submissions stay held: the count read below is the total
        await h.rpcStub.releaseOneMembershipSubmission(participant.index);

        expect(await topUp).to.equal(true);
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(3);
        // the chain credited the requested amount exactly once
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([5n]);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
        await releaseAll();
    });

    it("a top-up refused on a moved snapshot at every submission stops retrying at the channel's maximum participant count: after that many retries it returns false, no further confirmation is collected, and the participation is kept with no abort", async function () {
        const h = TestSession.getHarness();
        // four seats: at most four retries
        await h.scenario.syncSpectator(4, { maxChannelParticipants: 4 });
        const participant = h.getPeer(0);
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        const countersigned = await countJoinSignatureRequests(
            h,
            await remoteThresholdPeerIndices(h, participant.index)
        );
        const topUp = participant.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true, balance: { amount: 5, data: "0x" } }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        topUp.catch(() => undefined);

        // the first submission and its four retries are each refused on a stale pin
        await refuseHeldJoinsOnSnapshotMoves(h, participant.index, 5);

        expect(await topUp).to.equal(false);
        // later submissions stay held: the count read below is the total
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(5);
        // five collections (the first and four retries), each asking the two
        // other founders once: none after the fifth refusal
        expect(await countersigned()).to.equal(10);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([]);
    });

    it("a top-up that fails while the snapshot stays put is not retried: it returns false after one submission and keeps the participation", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        await h.rpcStub.failMembershipReceipt(
            participant.index,
            "topUpBalance"
        );

        expect(
            await participant.p2pInstance.p2pSigner.connectToChannel(
                h.channelId!,
                { shouldJoin: true, balance: { amount: 5, data: "0x" } }
            )
        ).to.equal(false);

        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
    });

    it("a top-up whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it returns false after one submission and keeps the participation", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner: participant,
            channelId: h.channelId!,
            jcOverrides: { balance: { amount: 5n, data: "0x00" } }
        });
        await moveChainSnapshot(h);
        await h.rpcStub.failMembershipSubmissionUncertain(
            participant.index,
            "topUpBalance"
        );
        const signatureRequests = await countJoinSignatureRequests(h, [1, 2]);

        expect(
            await participant.p2pInstance.p2pSigner.topUpBalance(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            )
        ).to.equal(false);

        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        expect(await signatureRequests()).to.equal(0);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a join whose snapshot moves to one this joiner has not stored is not prepared again: no fresh confirmation is collected and the join fails on its race", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        // the joiner neither stores the new snapshot's block nor handles its
        // snapshot event, so only the retry predicate sees the move
        await h.rpcStub.dropNetworkConfirmations(joiner.index);
        await h.control(joiner).stub.stubHoldSnapshotUpdatedEvents().request();
        await moveChainSnapshot(h, { isChainOnly: true });
        const signatureRequests = await countJoinSignatureRequests(
            h,
            [0, 1, 2]
        );

        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            )
        ).to.equal(false);

        expect(await signatureRequests()).to.equal(0);
        await waitFor(
            async () => joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a join pinned to a snapshot this joiner never stored is not prepared again: no fresh confirmation is collected and the join fails on its race", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        const signatureRequests = await countJoinSignatureRequests(
            h,
            [0, 1, 2]
        );

        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                `0x${"77".repeat(32)}`,
                expectedForkId
            )
        ).to.equal(false);

        expect(await signatureRequests()).to.equal(0);
        await waitFor(
            async () => joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a join whose receipt fails without a decoded race while the snapshot moved to a stored one is prepared again once and the joiner is admitted", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        await moveChainSnapshot(h);
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel", {
            once: true
        });
        const signatureRequests = await countJoinSignatureRequests(
            h,
            [0, 1, 2]
        );

        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            )
        ).to.equal(true);

        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        // one fresh collection: one request to each remote threshold member
        expect(await signatureRequests()).to.equal(
            (await remoteThresholdPeerIndices(h, joiner.index)).length
        );
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
    });

    it("a join whose retry after a snapshot move fails again on a failed receipt with no further move is final: it returns false after two submissions and the joiner stays SYNCED", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        await moveChainSnapshot(h);
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel");
        const signatureRequests = await countJoinSignatureRequests(
            h,
            [0, 1, 2]
        );

        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            )
        ).to.equal(false);

        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        expect(await signatureRequests()).to.equal(
            (await remoteThresholdPeerIndices(h, joiner.index)).length
        );
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a join whose fresh retry collection is held past the refused attempt's authorization deadline stays one pending join: the refused attempt's expiry check ends nothing, no onLeftChannel is emitted, and the retry lands under its own deadline", async function () {
        const h = TestSession.getHarness();
        const prepared = await prepareJoinWithAuthorization(h, 10);
        const joiner = prepared.joiner;
        const joinerPeer = h.getPeer(joiner.index);
        const stub = h.control(joiner).stub;
        // no block is authored while the authorization runs out: a writer's
        // timeout dispute would refuse the retry on a disputed fork
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
        // the refused attempt's expiry task is held when armed and run below,
        // after its deadline passed on chain
        const expiry = await h.rpcStub.holdScheduledTasks(
            joiner.index,
            "join authorization expiry"
        );
        let isExpiryReleased = false;
        try {
            await moveChainSnapshot(h);
            const releaseAll = await h.rpcStub.holdMembershipSubmission(
                joiner.index,
                "joinChannel"
            );
            const statusChangesBefore =
                joiner.eventSpies.onStatusChanged?.callCount ?? 0;
            let isSettled = false;
            const join = joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            const markSettled = () => {
                isSettled = true;
            };
            join.then(markSettled, markSettled);
            await waitForHeldJoins(h, joiner.index, 1);
            // the fresh collection for the retry is held mid-way
            await stub.holdJoinThresholdRead().request();
            await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
            await waitFor(
                async () =>
                    (await stub.getJoinThresholdReadEntered().request()) === 1,
                h.event.protocolEventTimeoutMs()
            );

            await chainBlockPastWait(h, prepared.joinDeadline);
            isExpiryReleased = true;
            await expiry.release(true);
            await waitForJoinChecks(h, joinerPeer);

            // one logical join: nothing ended it or reported it meanwhile
            expect(isSettled).to.equal(false);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect((await readTrackedJoin(h, joinerPeer))?.isRetrying).to.equal(
                true
            );

            await stub.releaseJoinThresholdRead().request();
            // the retry is the second and last submission
            await waitForHeldJoins(h, joiner.index, 2);
            await releaseAll();

            expect(await join).to.equal(true);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await h.channelManager.getPendingParticipants(h.channelId)
            ).to.include(joiner.address);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            const statusesSinceJoin = (
                joiner.eventSpies.onStatusChanged?.getCalls() ?? []
            )
                .slice(statusChangesBefore)
                .map((call) => call.args[1] as Status);
            expect(statusesSinceJoin).to.not.include(Status.SYNCED);
            // the landed retry is tracked under its own, later deadline
            expect(
                (await readTrackedJoin(h, joinerPeer))?.authorizationDeadline
            ).to.be.greaterThan(prepared.joinDeadline);
        } finally {
            if (!isExpiryReleased) await expiry.release(false);
        }
    });

    it("a join whose expiry check already read the chain's absent membership when the submission is refused stays one pending join: the check resumes during the held fresh collection and ends nothing, and the retry lands", async function () {
        const h = TestSession.getHarness();
        const prepared = await prepareJoinWithAuthorization(h, 10);
        const joiner = prepared.joiner;
        const joinerPeer = h.getPeer(joiner.index);
        const stub = h.control(joiner).stub;
        // no block is authored while the authorization runs out: a writer's
        // timeout dispute would refuse the retry on a disputed fork
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
        // the expiry task is held when armed and run below, after the
        // deadline passed on chain while the submission is still held
        const expiry = await h.rpcStub.holdScheduledTasks(
            joiner.index,
            "join authorization expiry"
        );
        let isExpiryReleased = false;
        let read: HeldForceJoinMembershipRead | undefined;
        let releaseAll: (() => Promise<number>) | undefined;
        try {
            await moveChainSnapshot(h);
            releaseAll = await h.rpcStub.holdMembershipSubmission(
                joiner.index,
                "joinChannel"
            );
            const statusChangesBefore =
                joiner.eventSpies.onStatusChanged?.callCount ?? 0;
            let isSettled = false;
            const join = joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            const markSettled = () => {
                isSettled = true;
            };
            join.then(markSettled, markSettled);
            await waitForHeldJoins(h, joiner.index, 1);
            await stub.holdJoinThresholdRead().request();
            read = await holdForceJoinMembershipRead(h, joiner.index, {
                check: "joinExpiry"
            });

            // the expiry check passes its entry guard and reads the chain
            // after the deadline: the joiner is absent
            await chainBlockPastWait(h, prepared.joinDeadline);
            // the real timer fires once the joiner's own clock passed the
            // deadline; that clock can lag the chain's block timestamps
            await waitFor(
                async () =>
                    (await h
                        .control(joiner)
                        .query.getClockTimeInSeconds()
                        .request()) > prepared.joinDeadline,
                h.event.protocolEventTimeoutMs()
            );
            isExpiryReleased = true;
            await expiry.release(true);
            await waitFor(read.entered, h.event.protocolEventTimeoutMs());
            expect(await read.answer()).to.equal(false);

            // the refused submission's retry collection is held
            await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
            await waitFor(
                async () =>
                    (await stub.getJoinThresholdReadEntered().request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await read.release();
            await waitForJoinChecks(h, joinerPeer);

            // one logical join: the resumed check ended nothing
            expect(isSettled).to.equal(false);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect((await readTrackedJoin(h, joinerPeer))?.isRetrying).to.equal(
                true
            );

            await stub.releaseJoinThresholdRead().request();
            // the retry is the second and last submission
            await waitForHeldJoins(h, joiner.index, 2);
            // later submissions stay held: the count read below is the total
            await h.rpcStub.releaseOneMembershipSubmission(joiner.index);

            expect(await join).to.equal(true);
            expect(
                await stub.getHeldMembershipReceiptCount().request()
            ).to.equal(2);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await h.channelManager.getPendingParticipants(h.channelId)
            ).to.include(joiner.address);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            const statusesSinceJoin = (
                joiner.eventSpies.onStatusChanged?.getCalls() ?? []
            )
                .slice(statusChangesBefore)
                .map((call) => call.args[1] as Status);
            expect(statusesSinceJoin).to.not.include(Status.SYNCED);
        } finally {
            await releaseAll?.();
            await read?.release();
            await stub.releaseJoinThresholdRead().request();
            if (!isExpiryReleased) await expiry.release(false);
        }
    });

    it("a join whose expiry check runs while the refused submission's retry-eligibility read is in flight stays one pending join: the check ends nothing, and the retry lands", async function () {
        const h = TestSession.getHarness();
        const prepared = await prepareJoinWithAuthorization(h, 10);
        const joiner = prepared.joiner;
        const joinerPeer = h.getPeer(joiner.index);
        const stub = h.control(joiner).stub;
        // no block is authored while the authorization runs out: a writer's
        // timeout dispute would refuse the retry on a disputed fork
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
        // the expiry task is held when armed and run below, after the
        // deadline passed on chain
        const expiry = await h.rpcStub.holdScheduledTasks(
            joiner.index,
            "join authorization expiry"
        );
        let isExpiryReleased = false;
        let releaseAll: (() => Promise<number>) | undefined;
        try {
            await moveChainSnapshot(h);
            releaseAll = await h.rpcStub.holdMembershipSubmission(
                joiner.index,
                "joinChannel"
            );
            const statusChangesBefore =
                joiner.eventSpies.onStatusChanged?.callCount ?? 0;
            let isSettled = false;
            const join = joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            const markSettled = () => {
                isSettled = true;
            };
            join.then(markSettled, markSettled);
            await waitForHeldJoins(h, joiner.index, 1);
            await stub.holdJoinRetryEligibilityRead().request();

            // the refused submission's retry-eligibility read is held
            await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
            await waitFor(
                async () =>
                    (await stub
                        .getJoinRetryEligibilityReadEntered()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await chainBlockPastWait(h, prepared.joinDeadline);
            isExpiryReleased = true;
            await expiry.release(true);
            await waitForJoinChecks(h, joinerPeer);

            // one logical join: the expiry check ended nothing
            expect(isSettled).to.equal(false);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect((await readTrackedJoin(h, joinerPeer))?.isRetrying).to.equal(
                true
            );

            await stub.releaseJoinRetryEligibilityRead().request();
            // the retry is the second and last submission
            await waitForHeldJoins(h, joiner.index, 2);
            // later submissions stay held: the count read below is the total
            await h.rpcStub.releaseOneMembershipSubmission(joiner.index);

            expect(await join).to.equal(true);
            expect(
                await stub.getHeldMembershipReceiptCount().request()
            ).to.equal(2);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await h.channelManager.getPendingParticipants(h.channelId)
            ).to.include(joiner.address);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            const statusesSinceJoin = (
                joiner.eventSpies.onStatusChanged?.getCalls() ?? []
            )
                .slice(statusChangesBefore)
                .map((call) => call.args[1] as Status);
            expect(statusesSinceJoin).to.not.include(Status.SYNCED);
        } finally {
            await releaseAll?.();
            await stub.releaseJoinRetryEligibilityRead().request();
            if (!isExpiryReleased) await expiry.release(false);
        }
    });

    it("a join disposed while the fresh confirmation for its retry is being collected submits nothing more once the collection continues: no JOIN lands for the joiner", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        const fromBlock = await h
            .getPeer(0)
            .p2pInstance.chainSigner.provider!.getBlockNumber();
        await moveChainSnapshot(h);
        const stub = h.control(joiner).stub;
        // the disposal releases this hold, so the collection continues into
        // the disposed runtime
        await stub.holdJoinThresholdRead().request();
        const join = joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        // settled below; the disposal may reject it
        join.catch(() => undefined);
        // the stale pin is refused; the fresh collection is held
        await waitFor(
            async () =>
                (await stub.getJoinThresholdReadEntered().request()) === 1,
            h.event.protocolEventTimeoutMs()
        );

        await joiner.p2pInstance.dispose();

        expect(await join.catch(() => false)).to.equal(false);
        // absence window: a retry submitted after the disposal lands its JOIN
        // within it
        await sleep(5_000);
        expect(
            await chainJoinAmounts(h, joiner.address, fromBlock)
        ).to.deep.equal([]);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a top-up whose runtime aborts once the fresh confirmation for its retry is collected submits nothing more: the call returns false and no JOIN lands for the participant", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner: participant,
            channelId: h.channelId!,
            jcOverrides: { balance: { amount: 5n, data: "0x00" } }
        });
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        await moveChainSnapshot(h);
        const stub = h.control(participant).stub;
        await stub.holdJoinCollectionResult().request();
        const topUp = participant.p2pInstance.p2pSigner.topUpBalance(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        // settled below; the abort may reject it
        topUp.catch(() => undefined);
        // the stale pin is refused; the fresh confirmation is collected and held
        await waitFor(
            async () =>
                (await stub.getJoinCollectionResultEntered().request()) === 1,
            h.event.protocolEventTimeoutMs()
        );

        // the teardown drains the released top-up before the runtime closes
        await stub.abortReleasingJoinCollectionResult().request();
        await waitFor(
            () => runtimeIsClosed(participant.p2pInstance),
            h.event.protocolEventTimeoutMs()
        );

        expect(await topUp.catch(() => false)).to.equal(false);
        expect(participant.eventSpies.onAbort?.callCount ?? 0).to.equal(1);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([]);
    });

    it("two synced spectators whose first joins race on one table both end pending: the join that lands second is refused for the threshold set the first widened and lands on its retry, whose fresh collection the first joiner countersigns", async function () {
        const h = TestSession.getHarness();
        const first = await h.scenario.syncSpectator();
        const { peer: second } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 0,
            maximumBlocks: 16
        });
        await h.assert.sync.peersInSyncWait();
        const releaseFirst = await h.rpcStub.holdMembershipSubmission(
            first.index,
            "joinChannel"
        );
        const releaseSecond = await h.rpcStub.holdMembershipSubmission(
            second.index,
            "joinChannel"
        );
        const countersignedByFirst = await countJoinSignatureRequests(h, [
            first.index
        ]);
        const firstJoin = first.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        const secondJoin = second.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        firstJoin.catch(() => undefined);
        secondJoin.catch(() => undefined);
        // both confirmations are collected against the founders alone
        await waitForHeldJoins(h, first.index, 1);
        await waitForHeldJoins(h, second.index, 1);

        // the first lands with its one submission and enters the threshold
        // set as pending
        await releaseFirst();
        expect(await firstJoin).to.equal(true);
        expect(
            await h.channelManager.getOnChainThresholdSet(h.channelId)
        ).to.include(first.address);
        // the second's confirmation lacks the first's countersignature; its
        // retry is its second and last submission
        await h.rpcStub.releaseOneMembershipSubmission(second.index);
        await waitForHeldJoins(h, second.index, 2);
        await releaseSecond();

        expect(await secondJoin).to.equal(true);
        const pending = await h.channelManager.getPendingParticipants(
            h.channelId
        );
        for (const joiner of [first, second]) {
            expect(pending).to.include(joiner.address);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
        }
        // the retry's fresh collection asked the new pending participant once
        expect(await countersignedByFirst()).to.equal(1);
    });

    it("two synced spectators whose joins race on one table both end pending when the second's transaction is estimated before the first lands and mined after it: the mined refusal for the widened threshold set is collected again, countersigned by the first, and lands with no abort", async function () {
        const h = TestSession.getHarness();
        const first = await h.scenario.syncSpectator();
        const { peer: second } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 0,
            maximumBlocks: 16
        });
        await h.assert.sync.peersInSyncWait();
        const secondSend = await h.rpcStub.holdFirstJoinSendAfterEstimate(
            second.index
        );
        const countersignedByFirst = await countJoinSignatureRequests(h, [
            first.index
        ]);
        const secondJoin = second.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        secondJoin.catch(() => undefined);
        // the second's transaction is estimated against the founders alone
        await secondSend.waitUntilHeld();

        // the first lands pending and widens the threshold set
        expect(
            await first.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true
            })
        ).to.equal(true);
        expect(
            await h.channelManager.getOnChainThresholdSet(h.channelId)
        ).to.include(first.address);
        // the second's transaction is mined after the first: a failed receipt
        await secondSend.release();

        expect(await secondJoin).to.equal(true);
        expect(await countersignedByFirst()).to.equal(1);
        const pending = await h.channelManager.getPendingParticipants(
            h.channelId
        );
        for (const joiner of [first, second]) {
            expect(pending).to.include(joiner.address);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
        }
    });

    it("a connect's join whose mined submission reverts with no revert data while its replay at the latest block passes is submitted again with the same confirmation and lands: true after two submissions, one collection, one JOIN on chain, and no abort", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const thresholdPeers = await remoteThresholdPeerIndices(
            h,
            joiner.index
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            thresholdPeers
        );
        const fromBlock =
            await joiner.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel", {
            once: true,
            isReplayPassing: true
        });

        expect(
            await joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true,
                balance: { amount: 5n, data: "0x00" }
            })
        ).to.equal(true);

        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        // the second submission reuses the first collection
        expect(await signatureRequests()).to.equal(thresholdPeers.length);
        expect(
            await chainJoinAmounts(h, joiner.address, fromBlock)
        ).to.deep.equal([5n]);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
    });

    it("a connect's join whose mined submission reverts with no revert data while its replay passes is submitted again, and that resubmission, estimated before another join lands and mined after it, is refused for the widened threshold set: it is collected again, countersigned by the landed joiner, and lands on its third submission with no abort", async function () {
        const h = TestSession.getHarness();
        const first = await h.scenario.syncSpectator();
        const { peer: second } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 0,
            maximumBlocks: 16
        });
        await h.assert.sync.peersInSyncWait();
        const fromBlock =
            await second.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.failMembershipReceipt(second.index, "joinChannel", {
            once: true,
            isReplayPassing: true
        });
        // the failed first submission sends nothing: the held send is the resubmission
        const resubmission = await h.rpcStub.holdFirstJoinSendAfterEstimate(
            second.index
        );
        const countersignedByFirst = await countJoinSignatureRequests(h, [
            first.index
        ]);
        const secondJoin = second.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true, balance: { amount: 5n, data: "0x00" } }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        secondJoin.catch(() => undefined);
        // the resubmission is estimated against the founders alone
        await resubmission.waitUntilHeld();

        // the first lands pending and widens the threshold set
        expect(
            await first.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true
            })
        ).to.equal(true);
        // the resubmission is mined after the first: a failed receipt
        await resubmission.release();

        expect(await secondJoin).to.equal(true);
        expect(
            await h
                .control(second)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(3);
        expect(await countersignedByFirst()).to.equal(1);
        expect(
            await chainJoinAmounts(h, second.address, fromBlock)
        ).to.deep.equal([5n]);
        const pending = await h.channelManager.getPendingParticipants(
            h.channelId
        );
        for (const joiner of [first, second]) {
            expect(pending).to.include(joiner.address);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
            expect(joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(0);
        }
    });

    it("a connect's join whose mined submission keeps reverting with no revert data while its replay keeps passing stops at the channel's maximum participant count of retries: false after that many retries plus the first submission, one collection, no JOIN on chain, and the joiner back to SYNCED with no abort", async function () {
        const h = TestSession.getHarness();
        // four seats: at most four retries
        const joiner = await h.scenario.syncSpectator(4, {
            maxChannelParticipants: 4
        });
        const thresholdPeers = await remoteThresholdPeerIndices(
            h,
            joiner.index
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            thresholdPeers
        );
        const fromBlock =
            await joiner.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel", {
            isReplayPassing: true
        });

        expect(
            await joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true,
                balance: { amount: 5n, data: "0x00" }
            })
        ).to.equal(false);

        // the first submission and its four retries
        expect(
            await h
                .control(joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(5);
        // every submission again reuses the first collection
        expect(await signatureRequests()).to.equal(thresholdPeers.length);
        expect(
            await chainJoinAmounts(h, joiner.address, fromBlock)
        ).to.deep.equal([]);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a join refused twice for threshold sets that two joins landing one after another widened is collected again each time and lands on its third submission: each fresh collection asks the newly landed joiners, and no abort", async function () {
        const h = TestSession.getHarness();
        const race = await raceJoinPastTwoLandingJoins(h);
        expect(race.isFirstJoined).to.equal(true);
        expect(race.isSecondJoined).to.equal(true);
        // the second submission is refused for the set the second widened
        await h.rpcStub.releaseOneMembershipSubmission(race.joiner.index);
        await waitForHeldJoins(h, race.joiner.index, 3);
        // later submissions stay held: the count read below is the total
        await h.rpcStub.releaseOneMembershipSubmission(race.joiner.index);

        expect(await race.join).to.equal(true);
        expect(
            await h
                .control(race.joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(3);
        // each fresh collection asked every member of the widened set once
        expect(race.secondRound).to.deep.equal({ byFirst: 1 });
        expect(await race.countersignedByFirst()).to.equal(1);
        expect(await race.countersignedBySecond()).to.equal(1);
        const pending = await h.channelManager.getPendingParticipants(
            h.channelId
        );
        for (const joiner of [race.first, race.second, race.joiner]) {
            expect(pending).to.include(joiner.address);
            expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        }
        expect(
            await h.control(race.joiner).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);
        expect(race.joiner.eventSpies.onLeftChannel?.callCount ?? 0).to.equal(
            0
        );
        await race.releaseJoiner();
    });

    it("a connect's join to a channel already full is neither collected nor submitted: connect returns false and the joiner aborts", async function () {
        const h = TestSession.getHarness();
        const full = await joinFullChannel(h);

        expect(full.isJoined).to.equal(false);
        expect(full.countersignatures).to.equal(0);
        expect(full.joinAmounts).to.deep.equal([]);
        await waitFor(
            async () => full.joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(full.joiner.eventSpies.onAbort?.callCount).to.equal(1);
    });

    it("a connect's join with shouldSpectateWhenFull to a channel already full is neither collected nor submitted: connect returns false, and the joiner stays SYNCED with no abort and follows the next block", async function () {
        const h = TestSession.getHarness();
        const full = await joinFullChannel(h, { shouldSpectateWhenFull: true });

        expect(full.isJoined).to.equal(false);
        expect(full.countersignatures).to.equal(0);
        expect(full.joinAmounts).to.deep.equal([]);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2]
        });
        await h.assert.sync.peersInSyncWait();
        expect(
            await h.control(full.joiner).query.getStatus().request()
        ).to.equal(Status.SYNCED);
        expect(full.joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a connect's join to a channel that a pending participant fills is neither collected nor submitted: connect returns false and the joiner aborts", async function () {
        const h = TestSession.getHarness();
        // three founders seated and one landed join pending fill four seats
        const full = await joinFullChannel(h, { isFilledByPendingJoin: true });

        const pendingAddress = full.pendingJoiner!.address;
        expect(full.pendingAtConnect).to.include(pendingAddress);
        expect(full.participantsAtConnect).to.not.include(pendingAddress);
        expect(full.participantsAtConnect.length).to.equal(3);
        expect(full.isJoined).to.equal(false);
        expect(full.countersignatures).to.equal(0);
        expect(full.joinAmounts).to.deep.equal([]);
        await waitFor(
            async () => full.joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(full.joiner.eventSpies.onAbort?.callCount).to.equal(1);
    });

    it("a join whose retry after a threshold set refusal is refused because a second landed join filled the channel ends on that refusal: connect returns false after two submissions with no further collection, and the joiner aborts", async function () {
        const h = TestSession.getHarness();
        // the three founders and the two landed joiners fill the channel
        const race = await raceJoinPastTwoLandingJoins(h, {
            maxChannelParticipants: 5
        });
        expect(race.isFirstJoined).to.equal(true);
        expect(race.isSecondJoined).to.equal(true);
        // the held retry meets the full channel: too many participants
        await h.rpcStub.releaseOneMembershipSubmission(race.joiner.index);

        expect(await race.join).to.equal(false);
        await waitFor(
            async () => race.joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(race.joiner.eventSpies.onAbort?.callCount).to.equal(1);
        // later submissions stay held: the count read below is the total
        expect(
            await h
                .control(race.joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        expect(race.secondRound).to.deep.equal({ byFirst: 1 });
        expect(await race.countersignedByFirst()).to.equal(0);
        expect(await race.countersignedBySecond()).to.equal(0);
        const [participants, pending] = await Promise.all([
            h.channelManager.getParticipants(h.channelId),
            h.channelManager.getPendingParticipants(h.channelId)
        ]);
        expect(pending).to.not.include(race.joiner.address);
        expect(participants.length + pending.length).to.equal(5);
        // the abort disposed the runtime, so the release may reject
        await race.releaseJoiner().catch(() => undefined);
    });

    it("a join whose retry is refused because a second landed join filled the channel is not retried even when the snapshot moves to a stored one before the retry is decided: connect returns false after two submissions with no further collection, and the joiner aborts", async function () {
        const h = TestSession.getHarness();
        // the three founders and the two landed joiners fill the channel
        const race = await raceJoinPastTwoLandingJoins(h, {
            maxChannelParticipants: 5
        });
        expect(race.isFirstJoined).to.equal(true);
        expect(race.isSecondJoined).to.equal(true);
        const stub = h.control(race.joiner).stub;
        await stub.holdJoinRetryDecision().request();
        try {
            // the held retry meets the full channel: too many participants
            await h.rpcStub.releaseOneMembershipSubmission(race.joiner.index);
            await waitFor(
                async () =>
                    (await stub.getJoinRetryDecisionRefusals().request())
                        .length === 1,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                await stub.getJoinRetryDecisionRefusals().request()
            ).to.deep.equal(["ErrorTooManyParticipants"]);
            // before the retry is decided, the snapshot moves to one the
            // joiner stores: a snapshot race would now be retried
            await moveChainSnapshot(h);
        } finally {
            // the released decision aborts the join and disposes the runtime,
            // so the release reply may not arrive
            await stub
                .releaseJoinRetryDecision()
                .request()
                .catch(() => undefined);
        }

        expect(await race.join).to.equal(false);
        await waitFor(
            async () => race.joiner.eventSpies.onAbort?.called === true,
            h.event.protocolEventTimeoutMs()
        );
        expect(race.joiner.eventSpies.onAbort?.callCount).to.equal(1);
        // later submissions stay held: the count read below is the total
        expect(
            await h
                .control(race.joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        expect(await race.countersignedByFirst()).to.equal(0);
        expect(await race.countersignedBySecond()).to.equal(0);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(race.joiner.address);
        // the abort disposed the runtime, so the release may reject
        await race.releaseJoiner().catch(() => undefined);
    });

    it("a join with shouldSpectateWhenFull whose retry after a threshold set refusal is refused because a second landed join filled the channel ends on that refusal: connect returns false after two submissions with no further collection, and the joiner is back to SYNCED with no abort", async function () {
        const h = TestSession.getHarness();
        // the three founders and the two landed joiners fill the channel
        const race = await raceJoinPastTwoLandingJoins(h, {
            maxChannelParticipants: 5,
            shouldSpectateWhenFull: true
        });
        expect(race.isFirstJoined).to.equal(true);
        expect(race.isSecondJoined).to.equal(true);
        // the held retry meets the full channel: too many participants
        await h.rpcStub.releaseOneMembershipSubmission(race.joiner.index);

        expect(await race.join).to.equal(false);
        // later submissions stay held: the count read below is the total
        expect(
            await h
                .control(race.joiner)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        expect(race.secondRound).to.deep.equal({ byFirst: 1 });
        expect(await race.countersignedByFirst()).to.equal(0);
        expect(await race.countersignedBySecond()).to.equal(0);
        expect(
            await h.control(race.joiner).query.getStatus().request()
        ).to.equal(Status.SYNCED);
        expect(race.joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        await h.event.waitUntilLeftChannel(race.joiner.index);
        expect(race.joiner.eventSpies.onLeftChannel?.callCount).to.equal(1);
        const [participants, pending] = await Promise.all([
            h.channelManager.getParticipants(h.channelId),
            h.channelManager.getPendingParticipants(h.channelId)
        ]);
        expect(pending).to.include.members([
            race.first.address,
            race.second.address
        ]);
        expect(pending).to.not.include(race.joiner.address);
        expect(participants.length + pending.length).to.equal(5);
        await race.releaseJoiner();
    });

    it("a prepared join submitted to a channel that a landed pending join fills makes no full-channel read and is refused for too many participants: joinChannel returns false after one submission, onLeftChannel then onAbort fire once each, and no JOIN lands for the joiner", async function () {
        const h = TestSession.getHarness();
        // the three founders and one landed join fill four seats
        const joiner = await h.scenario.syncSpectator(4, {
            maxChannelParticipants: 4
        });
        await landPendingJoin(h);
        // prepared once the channel is full, so its deadline and pin are fresh
        const { confirmation, expectedSnapshotHash, expectedForkId } =
            await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId!
            });
        const fromBlock =
            await joiner.p2pInstance.chainSigner.provider!.getBlockNumber();
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        // no full-channel read stops the prepared join: it is submitted
        await waitForHeldJoins(h, joiner.index, 1);
        // the retry decision names the refusal: a moved snapshot would be
        // refused first, and could abort for the wrong reason
        const stub = h.control(joiner).stub;
        // keeps the joiner's control RPC reachable after the abort, so the
        // reads below cannot race the runtime's disposal
        const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(
            joiner.index
        );
        try {
            await stub.holdJoinRetryDecision().request();
            try {
                await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
                await waitFor(
                    async () =>
                        (await stub.getJoinRetryDecisionRefusals().request())
                            .length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await stub.getJoinRetryDecisionRefusals().request()
                ).to.deep.equal(["ErrorTooManyParticipants"]);
            } finally {
                // the released decision aborts the join
                await stub.releaseJoinRetryDecision().request();
            }

            // the abort disposes the runtime, so the call may also reject
            expect(await join.catch(() => false)).to.equal(false);
            await waitFor(
                async () => joiner.eventSpies.onAbort?.called === true,
                h.event.protocolEventTimeoutMs()
            );
            await h.event.waitUntilLeftChannel(joiner.index);
            const spies = joiner.eventSpies;
            expect(spies.onLeftChannel?.callCount).to.equal(1);
            expect(spies.onAbort?.callCount).to.equal(1);
            expect(
                spies
                    .onLeftChannel!.getCall(0)
                    .calledBefore(spies.onAbort!.getCall(0))
            ).to.equal(true);
            // later submissions stay held: the count read below is the total
            expect(
                await h
                    .control(joiner)
                    .stub.getHeldMembershipReceiptCount()
                    .request()
            ).to.equal(1);
            expect(
                await chainJoinAmounts(h, joiner.address, fromBlock)
            ).to.deep.equal([]);
        } finally {
            await releaseAll();
            await releaseDisposal();
        }
    });

    it("a join refused and retried once, whose runtime aborts while the retry's submission is held at its send, handles no refusal of that submission: connect returns false, and the status stays OPENED", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        await h.rpcStub.holdMembershipSubmission(joiner.index, "joinChannel");
        const join = joiner.p2pInstance.p2pSigner.connectToChannel(
            h.channelId!,
            { shouldJoin: true }
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitForHeldJoins(h, joiner.index, 1);

        await moveChainSnapshot(h);
        await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
        // the first submission reverts on its stale pin; the retry is held
        await waitForHeldJoins(h, joiner.index, 2);
        // the retry's pin goes stale too, so its submission is refused
        await moveChainSnapshot(h);
        const statusChangesBefore =
            joiner.eventSpies.onStatusChanged?.callCount ?? 0;
        // the held retry runs into the disposed runtime and is refused
        await h
            .control(joiner)
            .stub.abortReleasingMembershipSubmission()
            .request();

        expect(await join).to.equal(false);
        const statusesSinceAbort = (
            joiner.eventSpies.onStatusChanged?.getCalls() ?? []
        )
            .slice(statusChangesBefore)
            .map((call) => call.args[1] as Status);
        expect(statusesSinceAbort).to.deep.equal([Status.OPENED]);
        expect(joiner.eventSpies.onAbort?.callCount ?? 0).to.equal(1);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("a participant's top-up held at its send while a spectator's join lands is refused for the threshold set that join widened, collected again once with the new pending participant's countersignature, and lands: two submissions, the amount credited once, and the participation kept", async function () {
        const h = TestSession.getHarness();
        const spectator = await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner: participant,
            channelId: h.channelId!,
            jcOverrides: { balance: { amount: 5n, data: "0x00" } }
        });
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        try {
            const topUp = participant.p2pInstance.p2pSigner.topUpBalance(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            // observed below; keeps a failure from being an unhandled rejection meanwhile
            topUp.catch(() => undefined);
            await waitForHeldJoins(h, participant.index, 1);

            // the spectator's join lands and widens the threshold set
            expect(
                await spectator.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId!,
                    { shouldJoin: true }
                )
            ).to.equal(true);
            expect(
                await h.channelManager.getOnChainThresholdSet(h.channelId)
            ).to.include(spectator.address);
            // the snapshot stays put: only the threshold set refuses the held top-up
            expect(
                StateSnapshot.from(
                    await h.channelManager.getStateSnapshot(h.channelId)
                ).hash
            ).to.equal(prepared.expectedSnapshotHash);
            let refusal: unknown;
            try {
                await h.channelManager
                    .connect(participant.signer)
                    .topUpBalance.staticCall(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    );
                expect.fail("expected the held top-up to be refused");
            } catch (error) {
                refusal = error;
            }
            expectDecodedError(
                refusal,
                "ErrorJoinChannelConfirmationNotThresholdSigned",
                "the top-up must be refused for the widened threshold set"
            );
            const countersignedBySpectator = await countJoinSignatureRequests(
                h,
                [spectator.index]
            );

            await h.rpcStub.releaseOneMembershipSubmission(participant.index);
            // the retry is the second and last submission
            await waitForHeldJoins(h, participant.index, 2);
            // later submissions stay held: the count read below is the total
            await h.rpcStub.releaseOneMembershipSubmission(participant.index);

            expect(await topUp).to.equal(true);
            expect(
                await h
                    .control(participant)
                    .stub.getHeldMembershipReceiptCount()
                    .request()
            ).to.equal(2);
            // the retry's fresh collection asked the new pending participant once
            expect(await countersignedBySpectator()).to.equal(1);
            expect(
                await chainJoinAmounts(h, participant.address, fromBlock)
            ).to.deep.equal([5n]);
            expect(
                await h.control(participant).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
            expect(participant.eventSpies.onAbort?.called ?? false).to.equal(
                false
            );
        } finally {
            await releaseAll();
        }
    });

    it("a top-up whose mined submission reverts with no revert data while its replay at the latest block passes is submitted again with the same confirmation and lands: true after two submissions, one collection, the amount credited once, and the participation kept", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const thresholdPeers = await remoteThresholdPeerIndices(
            h,
            participant.index
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            thresholdPeers
        );
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.failMembershipReceipt(
            participant.index,
            "topUpBalance",
            { once: true, isReplayPassing: true }
        );

        expect(
            await participant.p2pInstance.p2pSigner.connectToChannel(
                h.channelId!,
                { shouldJoin: true, balance: { amount: 5n, data: "0x00" } }
            )
        ).to.equal(true);

        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(2);
        // the second submission reuses the first collection
        expect(await signatureRequests()).to.equal(thresholdPeers.length);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([5n]);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a top-up whose mined submission reverts with no revert data while its replay passes is submitted again, and that resubmission, estimated before a spectator's join lands and mined after it, is refused for the widened threshold set: it is collected again, countersigned by the new pending participant, and lands on its third submission with the amount credited once", async function () {
        const h = TestSession.getHarness();
        const spectator = await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner: participant,
            channelId: h.channelId!,
            jcOverrides: { balance: { amount: 5n, data: "0x00" } }
        });
        await h.rpcStub.failMembershipReceipt(
            participant.index,
            "topUpBalance",
            { once: true, isReplayPassing: true }
        );
        // the failed first submission sends nothing: the held send is the resubmission
        const resubmission = await h.rpcStub.holdFirstJoinSendAfterEstimate(
            participant.index,
            "topUpBalance"
        );
        const countersignedBySpectator = await countJoinSignatureRequests(h, [
            spectator.index
        ]);
        const topUp = participant.p2pInstance.p2pSigner.topUpBalance(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        topUp.catch(() => undefined);
        // the resubmission is estimated against the founders alone
        await resubmission.waitUntilHeld();

        // the spectator's join lands and widens the threshold set
        expect(
            await spectator.p2pInstance.p2pSigner.connectToChannel(
                h.channelId!,
                { shouldJoin: true }
            )
        ).to.equal(true);
        // the resubmission is mined after the join: a failed receipt
        await resubmission.release();

        expect(await topUp).to.equal(true);
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(3);
        expect(await countersignedBySpectator()).to.equal(1);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([5n]);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("a top-up whose mined submission keeps reverting with no revert data while its replay keeps passing stops at the channel's maximum participant count of retries: false after that many retries plus the first submission, one collection, no JOIN on chain, and the participation kept with no abort", async function () {
        const h = TestSession.getHarness();
        // four seats: at most four retries
        await h.scenario.syncSpectator(4, { maxChannelParticipants: 4 });
        const participant = h.getPeer(0);
        const thresholdPeers = await remoteThresholdPeerIndices(
            h,
            participant.index
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            thresholdPeers
        );
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        await h.rpcStub.failMembershipReceipt(
            participant.index,
            "topUpBalance",
            { isReplayPassing: true }
        );

        expect(
            await participant.p2pInstance.p2pSigner.connectToChannel(
                h.channelId!,
                { shouldJoin: true, balance: { amount: 5n, data: "0x00" } }
            )
        ).to.equal(false);

        // the first submission and its four retries
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(5);
        // every submission again reuses the first collection
        expect(await signatureRequests()).to.equal(thresholdPeers.length);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([]);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
    });

    it("concurrent topUpBalance calls with one prepared request: the second call reuses the running top-up, so one funded submission credits the amount once and both calls return the same result", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const signer = participant.p2pInstance.p2pSigner;
        const fromBlock =
            await participant.p2pInstance.chainSigner.provider!.getBlockNumber();
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner: participant,
            channelId: h.channelId!,
            jcOverrides: { balance: { amount: 5n, data: "0x00" } }
        });
        const releaseAll = await h.rpcStub.holdMembershipSubmission(
            participant.index,
            "topUpBalance"
        );
        const topUp = () =>
            signer.topUpBalance(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
        const firstCall = topUp();
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        firstCall.catch(() => undefined);
        await waitForHeldJoins(h, participant.index, 1);
        const secondCall = topUp();
        secondCall.catch(() => undefined);
        // a later call on the same signer port: the host received the second
        // top-up before it answers this one
        await signer.getChannelStatus();
        // the second call entered no submission of its own
        expect(
            await h
                .control(participant)
                .stub.getHeldMembershipReceiptCount()
                .request()
        ).to.equal(1);
        await releaseAll();

        expect(await Promise.all([firstCall, secondCall])).to.deep.equal([
            true,
            true
        ]);
        expect(
            await chainJoinAmounts(h, participant.address, fromBlock)
        ).to.deep.equal([5n]);
    });

    it("concurrent connect joins on one synced spectator: the second call gets the running join's promise, so one collection and one funded submission land the join and both calls return true", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const thresholdPeers = await remoteThresholdPeerIndices(
            h,
            joiner.index
        );
        const signatureRequests = await countJoinSignatureRequests(
            h,
            thresholdPeers
        );
        const fromBlock =
            await joiner.p2pInstance.chainSigner.provider!.getBlockNumber();
        const stub = h.control(joiner).stub;
        // the first call's collection is held before it asks for any
        // countersignature, so the joiner stays SYNCED meanwhile
        await stub.holdJoinThresholdRead().request();
        await stub.recordCollectAndJoinEntries().request();
        const connect = () =>
            joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true,
                balance: { amount: 5n, data: "0x00" }
            });
        const firstCall = connect();
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        firstCall.catch(() => undefined);
        await waitFor(
            async () =>
                (await stub.getJoinThresholdReadEntered().request()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        const secondCall = connect();
        secondCall.catch(() => undefined);
        // the second call passes the host's connect steps and reaches the
        // join service while the first collection is held
        await waitFor(
            async () => (await stub.getCollectAndJoinEntered().request()) === 2,
            h.event.protocolEventTimeoutMs()
        );
        await stub.releaseJoinThresholdRead().request();

        expect(await Promise.all([firstCall, secondCall])).to.deep.equal([
            true,
            true
        ]);
        // one collection: each threshold member answered one request
        expect(await signatureRequests()).to.equal(thresholdPeers.length);
        expect(
            await chainJoinAmounts(h, joiner.address, fromBlock)
        ).to.deep.equal([5n]);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
    });
});
