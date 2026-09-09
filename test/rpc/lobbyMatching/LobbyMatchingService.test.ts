import { Status } from "@/types";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("LobbyMatchingService", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("does not call the configured filter for its own address", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyFilterBoundary(
                fixture.address(1),
                "self"
            )
            .request();
        expect(result).to.deep.equal({ calls: 0, sameError: false });
    });

    it("does not call the configured filter for an unknown transport", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyFilterBoundary(
                fixture.address(1),
                "unknown"
            )
            .request();
        expect(result).to.deep.equal({ calls: 0, sameError: false });
    });

    it("propagates the configured filter error unchanged for a foreign peer", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyFilterBoundary(
                fixture.address(1),
                "throw"
            )
            .request();
        expect(result).to.deep.equal({ calls: 1, sameError: true });
    });

    it("checks malformed availability and missing reservations before the configured filter", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyFilterOrder(fixture.address(1))
            .request();
        expect(result).to.deep.equal({
            beforeValid: 0,
            afterValid: 1,
            afterPick: 2,
            pick: "rejected"
        });
    });

    it("rejects zero lobby balance before changing the selected channel or status", async function () {
        const h = fixture.getHarness();
        const peer = h.getPeer(0);
        const result = await h.execOnHost(
            peer,
            async (sm, args) => {
                const channelId = sm.channelId;
                const status = sm.status;
                let message = "";
                try {
                    await sm.p2pManager.p2pSigner.joinLobby(args.topic, {
                        balance: { amount: 0n, data: "0x1234" }
                    });
                } catch (error) {
                    message =
                        error instanceof Error ? error.message : String(error);
                }
                return {
                    message,
                    unchanged:
                        channelId === sm.channelId && status === sm.status
                };
            },
            { topic: ethers.id("zero-lobby-balance") }
        );
        expect(result.message).to.equal("Balance must be greater than zero");
        expect(result.unchanged).to.equal(true);
    });

    it("bootstraps an advertiser, reserves one picker, and resolves only after valid commitment", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.role).to.equal("advertiser");
        expect(result.firstStatus).to.equal("accepted");
        expect(result.concurrentStatus).to.equal("busy");
        expect(result.malformedCommitStatus).to.equal("rejected");
        expect(result.validCommitStatus).to.equal("acknowledged");
        expect(result.candidateCountAfterSameEpochUnavailable).to.equal(0);
        expect(result.candidateCountAfterSameEpochReadvertisement).to.equal(1);
        expect(result.candidateCountAfterStaleAvailability).to.equal(1);
        expect(result.matchPeer.toLowerCase()).to.equal(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        expect(result.matchHasChannelId).to.equal(false);
        expect(result.localChannelId).to.equal(ethers.ZeroHash);
        expect(result.lobbyTransportsExcludedBeforeCommit).to.equal(true);
        expect(result.ordinaryHookCountBeforeCommit).to.equal(0);
        expect(result.selectedTransportHeldBeforeCompletion).to.equal(true);
        expect(result.selectedTransportHeldAfterExpiredTimeout).to.equal(true);
        expect(result.selectedTransportPromotedAfterCompletion).to.equal(true);
        expect(result.nonSelectedTransportClosed).to.equal(true);
        expect(result.ordinaryHookCountAfterCommitBeforeCompletion).to.equal(0);
        expect(result.ordinaryHookCountAfterCompletion).to.equal(1);
        expect(result.discardedPeerMissedOrdinaryBroadcast).to.equal(true);
    });

    it("keeps a reservation through final profile loss, blacklists at its bound, and bounds rejected lobby traffic", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyRecovery()
            .request();

        expect(result.reservationAccepted).to.equal(true);
        expect(result.reservedAfterFinalLoss).to.equal(true);
        expect(result.matchingAfterFinalLoss).to.equal(true);
        expect(result.disconnectedPeerBlacklisted).to.equal(false);
        // The reservation bound is one agreement window; the absent selector
        // is blacklisted when it fires and the reservation is released.
        await waitFor(
            async () =>
                (
                    await fixture
                        .control()
                        .p2pManagerProbe.probeLobbyRecoveryBound()
                        .request()
                ).disconnectedPeerBlacklisted,
            fixture.getHarness().event.protocolEventTimeoutMs(),
            100
        );
        const afterBound = await fixture
            .control()
            .p2pManagerProbe.probeLobbyRecoveryBound()
            .request();
        expect(afterBound.reserved).to.equal(false);
        expect(afterBound.matching).to.equal(true);
        expect(result.abusiveTransportClosed).to.equal(true);
        expect(result.abusivePeerReconnectBanned).to.equal(true);
        expect(result.abusivePeerBlacklisted).to.equal(false);
    });

    it("settles cancellation when the selected peer disconnects during commit", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyCommitCancellation()
            .request();

        expect(result).to.deep.equal({
            cancellationResult: true,
            matchResultMissing: true,
            topicCleared: true,
            matchingCleared: true,
            selectionCleared: true,
            candidateCount: 0,
            transportClosed: true,
            peerBlacklisted: true
        });
    });

    it("assigns opposite bootstrap roles and rejects invalid lobby candidates", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyBootstrapAndValidation()
            .request();

        expect(result.bothNoneRole).to.equal(result.bothNoneExpectedRole);
        expect(result.oneNoneRole).to.equal("selector");
        expect(result.malformedCandidateCount).to.equal(0);
        expect(result.wrongTopicCandidateCount).to.equal(0);
        expect(result.unauthenticatedCandidateCount).to.equal(0);
        expect(result.filteredCandidateCount).to.equal(0);
        expect(result.filteredPickStatus).to.equal("rejected");
    });

    it("uses bounded role jitter and defers a role transition while reserved", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyRoleTimers()
            .request();

        expect(result.defaultRoleDelayMs).to.be.at.least(1000);
        expect(result.defaultRoleDelayMs).to.be.at.most(2000);
        expect(result.configuredRoleDelayMs).to.equal(37);
        expect(result.roleWhileReservedAfterTimer).to.equal("advertiser");
        expect(result.commitAfterTimerStatus).to.equal("acknowledged");
        expect(result.reservationExpiryBlacklisted).to.equal(true);
        expect(result.roleTimerScheduleCount).to.equal(1);
        expect(result.availabilityFramesAfterExpiry).to.be.greaterThan(
            result.availabilityFramesBeforeExpiry
        );
    });

    it("settles replacement, leave, timeout, and disposal through one cleanup path", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result).to.deep.equal({
            defaultTimeoutScheduled: false,
            nullTimeoutScheduled: false,
            replacementResolvedUndefined: true,
            replacementTopicActive: true,
            replacementResolvedOnLeave: true,
            timeoutResolvedUndefined: true,
            timeoutClearedTopic: true,
            timeoutStatus: Status.NOT_OPENED,
            disposeResolvedUndefined: true,
            disposeClearedTopic: true,
            replacementClosedOldTransport: true,
            leaveClosedSessionTransport: true,
            timeoutClosedSessionTransport: true,
            disposeClosedSessionTransport: true,
            ordinaryCancellationSucceeded: true,
            targetedCancellationSucceeded: true,
            cancellationNoopAfterHandoff: true,
            handedOffTransportPreservedByCancellationNoop: true,
            negotiationHandoffReleased: true,
            selectedTargetRetainedAfterRelease: true
        });
    });

    it("returns a committed match without starting negotiation", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.matchHasChannelId).to.equal(false);
        expect(result.ordinaryHookCountAfterCommitBeforeCompletion).to.equal(0);
    });

    it("unmatched finite timeout cleans only matcher-owned resources", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result.timeoutResolvedUndefined).to.equal(true);
        expect(result.timeoutClearedTopic).to.equal(true);
        expect(result.timeoutStatus).to.equal(Status.NOT_OPENED);
    });

    it("accepted match cancels timeout before resolving", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.selectedTransportHeldAfterExpiredTimeout).to.equal(true);
    });

    it("accepted match disarms finite timeout before negotiation", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.selectedTransportHeldAfterExpiredTimeout).to.equal(true);
        expect(result.ordinaryHookCountAfterCommitBeforeCompletion).to.equal(0);
    });

    it("accepted match has no matchmaking timeout during negotiation", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.selectedTransportHeldAfterExpiredTimeout).to.equal(true);
        expect(result.selectedTransportHeldBeforeCompletion).to.equal(true);
    });

    it("finite matchmaking timeout returns false while unmatched", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result.timeoutResolvedUndefined).to.equal(true);
        expect(result.timeoutClearedTopic).to.equal(true);
    });

    it("completeLobby preserves the handed-off transport after targeted completion", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.selectedTransportHeldBeforeCompletion).to.equal(true);
        expect(result.selectedTransportPromotedAfterCompletion).to.equal(true);
        expect(result.nonSelectedTransportClosed).to.equal(true);
    });

    it("default lobby matching allows an authenticated peer without a filter", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.matchPeer).to.equal(
            ethers.getAddress("0xffffffffffffffffffffffffffffffffffffffff")
        );
    });

    it("ordinary and targeted callers share one unmatched cancellation owner", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result.ordinaryCancellationSucceeded).to.equal(true);
        expect(result.targetedCancellationSucceeded).to.equal(true);
    });

    it("matcher cancellation is a no-op after handoff", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result.cancellationNoopAfterHandoff).to.equal(true);
        expect(result.handedOffTransportPreservedByCancellationNoop).to.equal(
            true
        );
    });

    it("pre-open targeted lobby frames do not reach peers on the raw channel key", async function () {
        const h = fixture.getHarness();
        const target = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["string"],
                [h.options.channelId]
            )
        );
        const rawPeerIndex = h.peers.length;
        await h.createPeer(
            rawPeerIndex,
            h.signerFor(slotAccountIndex(rawPeerIndex))
        );
        await h.network.joinSelectedKey([rawPeerIndex], target);
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const connects = [0, 1].map((index) =>
            h.getPeer(index).p2pInstance.p2pSigner.connectToChannel(target, {
                autoOpen: true
            })
        );
        try {
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            [0, 1].map((index) =>
                                h
                                    .control(h.getPeer(index))
                                    .stub.getHeldMatchedNegotiationCount()
                                    .request()
                            )
                        )
                    ).every((count) => count === 1),
                h.event.protocolEventTimeoutMs()
            );
            expect(await h.query.getConnectionCount(rawPeerIndex)).to.equal(0);
            expect(
                await h
                    .control(h.getPeer(rawPeerIndex))
                    .query.getLobbyAvailability()
                    .request()
            ).to.include({ matching: false });
            await Promise.all(releases.map((release) => release()));
            expect(await Promise.all(connects)).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("pre-open routing probe settles after the raw-topic peer receives no frame", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyProtocol()
            .request();

        expect(result.discardedPeerMissedOrdinaryBroadcast).to.equal(true);
        expect(result.ordinaryHookCountAfterCommitBeforeCompletion).to.equal(0);
    });

    it("observed-open loser releases matching ownership for the selected channel", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbySessionCleanup()
            .request();

        expect(result.negotiationHandoffReleased).to.equal(true);
        expect(result.selectedTargetRetainedAfterRelease).to.equal(true);
    });

    it("keeps the local role epoch monotonic across same-topic retries", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyRetryEpoch()
            .request();

        expect(result.firstRoleEpoch).to.be.greaterThan(0);
        expect(result.secondRoleEpoch).to.be.greaterThan(result.firstRoleEpoch);
        expect(result.observerCandidateCountAfterFirstSession).to.equal(1);
        expect(result.observerCandidateCountAfterRetry).to.equal(1);
    });

    it("schedules only one advertiser switch while candidates stay exhausted", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyExhaustionTimer()
            .request();

        expect(result.scheduledAfterExhaustion).to.be.greaterThan(0);
        expect(result.scheduledAfterRepeatedAvailability).to.equal(
            result.scheduledAfterExhaustion
        );
    });

    it("rejects a late pick after commitment without blacklisting its requester", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyLatePick()
            .request();

        expect(result.responseStatus).to.equal("rejected");
        expect(result.requesterBlacklisted).to.equal(false);
    });

    it("bans reconnects of a peer that authenticates after the handoff", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLateJoinerAfterHandoff()
            .request();

        expect(result.commitAcknowledged).to.equal(true);
        expect(result.lateJoinerTransportClosed).to.equal(true);
        expect(result.lateJoinerReconnectBanned).to.equal(true);
        expect(result.lateJoinerBlacklisted).to.equal(false);
        expect(result.selectedPeerReconnectBanned).to.equal(false);
        expect(result.lateJoinerReconnectBannedAfterComplete).to.equal(false);
    });

    it("leaves the lobby topic before closing its transports and lifting session bans", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyCleanupOrdering()
            .request();

        expect(result.leaveObserved).to.equal(true);
        expect(result.sessionTransportOpenAtLeave).to.equal(true);
        expect(result.bannedPeerReconnectBannedAtLeave).to.equal(true);
        expect(result.sessionTransportClosedAfterCleanup).to.equal(true);
        expect(result.bannedPeerReconnectBannedAfterCleanup).to.equal(false);
    });

    it("does not session-ban rejected lobby traffic once the session has ended", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeRejectedRpcAfterLobbyEnded()
            .request();

        expect(result.sessionStarted).to.equal(true);
        expect(result.transportClosedAfterOverflow).to.equal(true);
        // No session is left to lift a ban, so none may be placed.
        expect(result.reconnectBannedAfterOverflow).to.equal(false);
        expect(result.reconnectAdmitted).to.equal(true);
    });

    it("starts a replacement match only after the previous cleanup has settled", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeCleanupSerializesWithMatch()
            .request();

        // The held cleanup owns the instance until it settles.
        expect(result.topicWhileCleanupHeld).to.equal(undefined);
        expect(result.secondSessionStarted).to.equal(true);
        expect(result.secondTransportOpen).to.equal(true);
        expect(result.secondSessionBanned).to.equal(true);
        expect(result.secondSessionLeft).to.equal(true);
        expect(result.secondResolvedUndefined).to.equal(true);
        expect(result.banLiftedAfterSecondCleanup).to.equal(true);
    });
});
