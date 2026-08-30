import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("LobbyMatchingService", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
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
        expect(result.selectedTransportPromoted).to.equal(true);
        expect(result.nonSelectedTransportClosed).to.equal(true);
        expect(result.ordinaryHookCountAfterCommit).to.equal(1);
        expect(result.discardedPeerMissedOrdinaryBroadcast).to.equal(true);
    });

    it("releases a reservation on final profile loss and bounds rejected lobby traffic", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeLobbyRecovery()
            .request();

        expect(result.reservationAccepted).to.equal(true);
        expect(result.reservedAfterFinalLoss).to.equal(false);
        expect(result.matchingAfterFinalLoss).to.equal(true);
        expect(result.disconnectedPeerBlacklisted).to.equal(false);
        expect(result.abusiveTransportClosed).to.equal(true);
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
            disposeClosedSessionTransport: true
        });
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
});
