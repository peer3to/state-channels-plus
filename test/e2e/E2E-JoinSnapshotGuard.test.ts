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
    moveChainSnapshot,
    refuseOneThresholdCountersignature,
    remoteThresholdPeerIndices,
    waitForHeldJoins
} from "@test/fixtures/JoinSnapshotRetryStaging";
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

    it("a connect's join whose snapshot moves again before its one retry lands fails as a join with no retry does: the joiner aborts and is not admitted", async function () {
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
        await waitForHeldJoins(h, joiner.index, 2);
        await moveChainSnapshot(h);
        await releaseAll();

        expect(await join).to.equal(false);
        expect(joiner.eventSpies.onAbort?.called).to.equal(true);
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

    it("a connect's join whose fresh confirmation for its one retry cannot be collected returns false with no second submission, and the joiner stays SYNCED", async function () {
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

    it("a top-up whose fresh confirmation for its one retry cannot be collected returns false with no second submission, and the participant keeps participating", async function () {
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

    it("a top-up whose snapshot moves again before its one retry lands returns false and keeps the participation", async function () {
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
        await h.rpcStub.releaseOneMembershipSubmission(participant.index);
        await waitForHeldJoins(h, participant.index, 2);
        await moveChainSnapshot(h);
        await releaseAll();

        expect(await topUp).to.equal(false);
        expect(
            await h.control(participant).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        expect(participant.eventSpies.onAbort?.called ?? false).to.equal(false);
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

    it("a join whose one retry fails again on a failed receipt after a snapshot move is final: it returns false after two submissions and the joiner stays SYNCED", async function () {
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
            // the fresh collection for the one retry is held mid-way
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
            // the one retry is the second and last submission
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

    it("a join whose expiry check already read the chain's absent membership when the submission is refused stays one pending join: the check resumes during the held fresh collection and ends nothing, and the one retry lands", async function () {
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
            // the one retry is the second and last submission
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

    it("a join whose expiry check runs while the refused submission's retry-eligibility read is in flight stays one pending join: the check ends nothing, and the one retry lands", async function () {
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
            // the one retry is the second and last submission
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

    it("a join disposed while the fresh confirmation for its one retry is being collected submits nothing more once the collection continues: no JOIN lands for the joiner", async function () {
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

    it("two synced spectators whose first joins race on one table both end pending: the join that lands second is refused for the threshold set the first widened and lands on its one retry, whose fresh collection the first joiner countersigns", async function () {
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
        // one retry is its second and last submission
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
            // the one retry is the second and last submission
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
});
