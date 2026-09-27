import { OpeningDataFixture } from "@test/fixtures/OpeningDataFixture";
import { expect } from "chai";

describe("OpenChannelNegotiationService opening data", function () {
    let fixture: OpeningDataFixture;

    beforeEach(async function () {
        fixture = new OpeningDataFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("lower address proposes empty opening data by default and opens", async function () {
        const result = await fixture
            .probe()
            .probeOpeningData("lower", "default")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.proposalData).to.equal("0x");
        expect(result.derivationCalls).to.deep.equal([]);
        expect(result.outcomeStatus).to.equal("opened");
        expect(result.channelOpen).to.equal(true);
    });

    it("higher address accepts empty opening data by default and opens", async function () {
        const result = await fixture
            .probe()
            .probeOpeningData("higher", "default")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.expectedData).to.equal("0x");
        expect(result.derivationCalls).to.deep.equal([]);
        expect(result.outcomeStatus).to.equal("opened");
        expect(result.channelOpen).to.equal(true);
    });

    it("lower address derives opening data from the exact agreed terms", async function () {
        const result = await fixture
            .probe()
            .probeOpeningData("lower", "derived")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.derivationCalls).to.deep.equal([result.expectedTerms]);
        expect(result.expectedTerms.balances).to.deep.equal([
            { amount: "321", data: "0x1234" },
            { amount: "700", data: "0x5678" }
        ]);
        expect(result.proposalData).to.equal(result.expectedData);
        expect(result.outcomeStatus).to.equal("opened");
        expect(result.channelOpen).to.equal(true);
    });

    it("higher address derives opening data from the exact agreed terms", async function () {
        const result = await fixture
            .probe()
            .probeOpeningData("higher", "derived")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.derivationCalls).to.deep.equal([result.expectedTerms]);
        expect(result.expectedTerms.balances).to.deep.equal([
            { amount: "700", data: "0x5678" },
            { amount: "321", data: "0x1234" }
        ]);
        expect(result.outcomeStatus).to.equal("opened");
        expect(result.channelOpen).to.equal(true);
    });

    it("lower address derivation failure clears the attempt without a proposal or penalty", async function () {
        const result = await fixture
            .probe()
            .probeDerivationFailure("lower")
            .request();

        expect(result).to.deep.equal({
            error: "",
            outcomeStatus: "retry",
            attemptCleared: true,
            channelIdCleared: true,
            proposalFrames: 0,
            channelOpen: false,
            peerBlacklisted: false,
            peerStrikes: 0,
            peerTransportClosed: false
        });
    });

    it("higher address derivation failure clears the attempt without co-signing or penalty", async function () {
        const result = await fixture
            .probe()
            .probeDerivationFailure("higher")
            .request();

        expect(result).to.deep.equal({
            error: "Opening data unavailable",
            outcomeStatus: "retry",
            attemptCleared: true,
            channelIdCleared: true,
            proposalFrames: 0,
            channelOpen: false,
            peerBlacklisted: false,
            peerStrikes: 0,
            peerTransportClosed: false
        });
    });

    it("lower address late derivation result after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("lower", "resolve")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.cancelledOutcome).to.equal("cancelled");
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.oldProposalFrames).to.equal(0);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("lower address late derivation failure after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("lower", "reject")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.cancelledOutcome).to.equal("cancelled");
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("higher address late derivation result after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("higher", "resolve")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.cancelledOutcome).to.equal("cancelled");
        expect(result.staleResult).to.equal("submitted");
        expect(result.oldChannelOpen).to.equal(false);
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("higher address late derivation failure after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("higher", "reject")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.cancelledOutcome).to.equal("cancelled");
        expect(result.staleResult).to.equal("Opening data unavailable");
        expect(result.oldChannelOpen).to.equal(false);
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("replacement opens without a signature or penalty from the cancelled attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("lower", "reject")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        // The new peer sees a signed proposal and an opened channel with
        // itself as participant.
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementParticipantsMatch).to.equal(true);
        expect(result.replacementPeerBlacklisted).to.equal(false);
        // The old peer never receives a signature, its channel never opens,
        // and it carries no verdict, strike or disconnect.
        expect(result.oldProposalFrames).to.equal(0);
        expect(result.oldChannelOpen).to.equal(false);
        expect(result.oldPeerBlacklisted).to.equal(false);
        expect(result.oldPeerStrikes).to.equal(0);
        expect(result.oldPeerTransportClosed).to.equal(false);
    });
});
