import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("OpenChannelNegotiationService", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("replays an early committed request and clears an unsigned abandoned attempt", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeMatchedNegotiationAdmission()
            .request();

        expect(result.responseBeforeInitialization).to.equal(false);
        expect(result.responseAfterInitialization).to.equal(true);
        expect(result.selectedChannelId).not.to.equal(ethers.ZeroHash);
        expect(result.peerBlacklistedAfterLoss).to.equal(true);
        expect(result.channelIdAfterLoss).to.equal(ethers.ZeroHash);
        expect(result.statusAfterLoss).to.equal(Status.NOT_OPENED);
    });

    it("rejects a non-finite opening amount and clears the attempt", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeInvalidNegotiationAmount()
            .request();

        expect(result.error).to.equal("Invalid opening amount");
        expect(result.peerBlacklisted).to.equal(true);
        expect(result.channelId).to.equal(ethers.ZeroHash);
        expect(result.status).to.equal(Status.DISCOVERING);
        expect(result.rendezvousTopic).to.equal(`0x${"24".repeat(32)}`);
        expect(result.matching).to.equal(true);
        expect(result.oldLobbyTransportClosed).to.equal(true);
    });

    it("punishes a silent lower-address initiator and clears the attempt", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("initiator-timeout")
            .request();

        expect(result).to.deep.equal({
            channelIdAfterHigherInit: ethers.ZeroHash,
            initiatorTimeoutBlacklisted: true,
            initiatorTimeoutCleared: true
        });
    });

    it("blacklists a wrong peer without changing the selected attempt", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("wrong-peer")
            .request();

        expect(result).to.deep.equal({
            wrongPeerBlacklisted: true,
            wrongPeerLeftAttemptActive: true
        });
    });

    it("blacklists the selected peer for a wrong attempt and clears it", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("wrong-attempt")
            .request();

        expect(result).to.deep.equal({
            wrongAttemptBlacklistedSelectedPeer: true,
            wrongAttemptCleared: true
        });
    });

    it("accepts duplicate terms but punishes conflicting terms", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("terms")
            .request();

        expect(result).to.deep.equal({
            duplicateTermsIdempotent: true,
            conflictingTermsBlacklisted: true
        });
    });

    it("blacklists and clears a malformed opening proposal", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("malformed-proposal")
            .request();

        expect(result).to.deep.equal({
            malformedProposalBlacklisted: true,
            malformedProposalCleared: true
        });
    });

    it("rejects an already-open derived ID without selecting it", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeNegotiationFailure("already-open")
            .request();

        expect(result).to.deep.equal({
            alreadyOpenRejected: true,
            alreadyOpenBlacklisted: true,
            alreadyOpenKeptZeroId: true
        });
    });

    it("retains signed attempts and observes chain open through the internal event bus", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeSignedAttemptObservation()
            .request();

        expect(result).to.deep.equal({
            submissionFailureThrew: true,
            higherSubmittedExactPayload: true,
            higherSubmittedBothSignatures: true,
            signedAttemptRetainedAfterSubmissionFailure: true,
            submissionFailureDidNotReportOpen: true,
            higherDidNotBlacklistLowerAfterSubmissionFailure: true,
            higherDidNotBlacklistLowerAfterExpiry: true,
            lowerDidNotBlacklistHigherBeforeExpiry: true,
            lowerBlacklistedHigherAfterExpiry: true,
            signedDisposeOutcomeCancelled: true,
            signedAttemptClearedOnDispose: true,
            signedPeerBlacklistedOnFinalLoss: true,
            signedAttemptRetainedAfterFinalLoss: true,
            signedAttemptClearedAfterExpiry: true,
            signedAttemptIdClearedAfterExpiry: true,
            wrongOpenEventIgnored: true,
            submissionStayedPendingUntilObservation: true,
            matchingOpenEventClearedAttempt: true,
            matchingOpenEventRetainedChannelId: true
        });
    });
});
