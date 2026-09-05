import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";

describe("OpenChannelNegotiationService", function () {
    let fixture: P2PManagerFixture;

    const probeTargetedNegotiationRaces = () =>
        fixture
            .control()
            .p2pManagerProbe.probeTargetedNegotiationRaces()
            .request({ timeoutMs: 20_000 });

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
        expect(result.statusAfterLoss).to.equal(Status.DISCOVERING);
    });

    it("rejects a non-finite opening amount and clears the attempt", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeInvalidNegotiationAmount()
            .request();

        expect(result.error).to.equal("Invalid opening balance");
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

    it("ordinary derived-ID already-open is failure with no raw-topic fallback", async function () {
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
            .request({
                timeoutMs: fixture
                    .getHarness()
                    .event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
            });

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
            matchingOpenEventRetainedChannelId: false
        });
    });

    it("targeted open during local signature wait skips transaction submission", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.signatureOutcome).to.equal("observed-target-open");
        expect(result.signatureSubmitCalls).to.equal(0);
        expect(result.signaturePeerBlacklisted).to.equal(false);
        expect(result.signatureAttemptCleared).to.equal(true);
    });

    it("target-open classification blocks submission until participant lookup completes", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.signatureLookupBlockedBeforeRelease).to.equal(true);
        expect(result.signatureSubmitCalls).to.equal(0);
        expect(result.signatureOutcome).to.equal("observed-target-open");
        expect(result.signaturePeerBlacklisted).to.equal(false);
    });

    it("targeted authoritative open returns the selected-channel handoff outcome", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.signatureOutcome).to.equal("observed-target-open");
        expect(result.signatureTargetRetained).to.equal(true);
        expect(result.signaturePeerBlacklisted).to.equal(false);
        expect(result.signatureAttemptCleared).to.equal(true);
    });

    it("negotiation probe settles at the observed-open handoff boundary", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.signatureOutcome).to.equal("observed-target-open");
        expect(result.signatureAttemptCleared).to.equal(true);
        expect(result.signatureTargetRetained).to.equal(true);
    });

    it("tx wait rejection becomes observed-open handoff when the targeted channel opened", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.receiptOutcome).to.equal("observed-target-open");
        expect(result.receiptSubmitCalls).to.equal(1);
        expect(result.receiptPeerBlacklisted).to.equal(false);
        expect(result.receiptAttemptCleared).to.equal(true);
        expect(result.receiptTargetRetained).to.equal(true);
        expect(result.detachedErrors).to.equal(0);
    });

    it("tx wait rejection remains an error while the target is unopened", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.unopenedReceiptOutcome).to.equal("targeted-failed");
        expect(result.unopenedReceiptError).to.contain(
            "targeted receipt failed while unopened"
        );
        expect(result.unopenedReceiptPeerBlacklisted).to.equal(false);
        expect(result.unopenedReceiptTargetRetained).to.equal(true);
    });

    it("ordinary derived-ID receipt rejection does not become an observed-open handoff", async function () {
        const result = await probeTargetedNegotiationRaces();

        expect(result.ordinaryReceiptOutcome).to.equal("retry");
        expect(result.ordinaryReceiptError).to.contain(
            "ordinary receipt failure"
        );
        expect(result.ordinaryReceiptPeerBlacklisted).to.equal(true);
        expect(result.ordinaryReceiptChannelCleared).to.equal(true);
    });

    it("clears the selected ID after an unsigned ordinary failure and resumes matching", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeMatchedNegotiationAdmission()
            .request();

        expect(result.channelIdAfterLoss).to.equal(ethers.ZeroHash);
        expect(result.statusAfterLoss).to.equal(Status.DISCOVERING);
    });

    it("matched negotiation ignores expired matchmaking timeout", async function () {
        // The probe waits for the opening to be observed on-chain, which
        // outlasts the default control RPC budget on a loaded farm.
        const result = await fixture
            .control()
            .p2pManagerProbe.probeSignedAttemptObservation()
            .request({
                timeoutMs: fixture
                    .getHarness()
                    .event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
            });

        expect(result.submissionStayedPendingUntilObservation).to.equal(true);
        expect(result.matchingOpenEventClearedAttempt).to.equal(true);
    });

    it("submitted opening transaction ignores expired matchmaking timeout", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeSignedAttemptObservation()
            .request({
                timeoutMs: fixture
                    .getHarness()
                    .event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
            });

        expect(result.higherSubmittedBothSignatures).to.equal(true);
        expect(result.submissionStayedPendingUntilObservation).to.equal(true);
    });

    it("ordinary joinLobby forwards supplied and default balances with an internal deadline", async function () {
        const h = fixture.getHarness();
        for (let index = h.peers.length; index < 4; index += 1) {
            await h.createPeer(index, h.signerFor(slotAccountIndex(index)));
        }
        const suppliedTopic = ethers.id("ordinary-supplied-balance");
        const defaultTopic = ethers.id("ordinary-default-balance");
        const [supplied, defaults] = await Promise.all([
            Promise.all(
                h.peers.slice(0, 2).map((peer) =>
                    peer.p2pInstance.p2pSigner.joinLobby(suppliedTopic, {
                        balance: { amount: 321n, data: "0x1234" }
                    })
                )
            ),
            Promise.all(
                h.peers
                    .slice(2, 4)
                    .map((peer) =>
                        peer.p2pInstance.p2pSigner.joinLobby(defaultTopic)
                    )
            )
        ]);
        expect(supplied.every((match) => match !== undefined)).to.equal(true);
        expect(defaults.every((match) => match !== undefined)).to.equal(true);
        if (!supplied[0] || !defaults[0]) {
            throw new Error("Expected both ordinary openings");
        }
        const channelIds = [supplied[0].channelId, defaults[0].channelId];
        await waitFor(
            async () =>
                (
                    await Promise.all(
                        channelIds.map((channelId) =>
                            h
                                .control(h.getPeer(0))
                                .query.isChannelOpen(channelId)
                                .request()
                        )
                    )
                ).every(Boolean),
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
        );
    });

    it("targeted auto-open forwards supplied and default balances with an internal deadline", async function () {
        const h = fixture.getHarness();
        for (let index = h.peers.length; index < 4; index += 1) {
            await h.createPeer(index, h.signerFor(slotAccountIndex(index)));
        }
        const suppliedTarget = ethers.id("targeted-supplied-balance");
        const defaultTarget = ethers.id("targeted-default-balance");
        const [supplied, defaults] = await Promise.all([
            Promise.all(
                h.peers.slice(0, 2).map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(
                        suppliedTarget,
                        {
                            autoOpen: true,
                            shouldJoin: true,
                            balance: { amount: 321n, data: "0x1234" }
                        }
                    )
                )
            ),
            Promise.all(
                h.peers.slice(2, 4).map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(defaultTarget, {
                        autoOpen: true,
                        shouldJoin: true
                    })
                )
            )
        ]);
        expect(supplied).to.deep.equal([true, true]);
        expect(defaults).to.deep.equal([true, true]);
    });
});
