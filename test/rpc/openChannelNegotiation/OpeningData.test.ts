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
        // the proposer signs the hash its hook derives for the signed terms
        expect(result.proposalGenesisStateHash).to.equal(
            result.derivedGenesisStateHash
        );
        expect(result.chainGenesisStateHash).to.equal(
            result.proposalGenesisStateHash
        );
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
        expect(result.chainGenesisStateHash).to.equal(
            result.derivedGenesisStateHash
        );
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
        expect(result.proposalGenesisStateHash).to.equal(
            result.derivedGenesisStateHash
        );
        expect(result.chainGenesisStateHash).to.equal(
            result.proposalGenesisStateHash
        );
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
        expect(result.chainGenesisStateHash).to.equal(
            result.derivedGenesisStateHash
        );
    });

    it("the lower address whose genesis hook rejects the agreed balances clears the attempt without blacklisting the peer or proposing", async function () {
        const result = await fixture
            .probe()
            .probeGenesisFailure("lower")
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

    it("the higher address whose genesis hook rejects the agreed balances clears the attempt without blacklisting, co-signing or opening", async function () {
        const result = await fixture
            .probe()
            .probeGenesisFailure("higher")
            .request();

        expect(result).to.deep.equal({
            error: "Genesis unavailable",
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

    it("the lower address whose signed proposal the higher cannot countersign for its own genesis failure counts one close at the deadline without blacklisting", async function () {
        const result = await fixture
            .probe()
            .probeCountersignFailure()
            .request();

        // the lower derived the proposed hash through the real facet hook
        expect(result).to.deep.equal({
            proposalHashDerived: true,
            strikesBeforeDeadline: 0,
            outcomeStatus: "retry",
            attemptCleared: true,
            channelOpen: false,
            peerBlacklisted: false,
            peerStrikes: 1
        });
    });

    it("blacklists and clears a proposal whose genesis hash differs from the locally computed genesis", async function () {
        const result = await fixture
            .probe()
            .probeAlteredProposal("genesis-hash")
            .request();

        expect(result).to.deep.equal({
            error: "Genesis state hash mismatch",
            attemptCleared: true,
            channelOpen: false,
            peerBlacklisted: true
        });
    });

    it("blacklists a proposal whose altered counterparty balance the genesis hook would reject", async function () {
        const result = await fixture
            .probe()
            .probeAlteredProposal("overflowing-balance")
            .request();

        // the terms check runs before the hook: an altered term, not a local failure
        expect(result).to.deep.equal({
            error: "Proposal mismatch: balance 0 amount mismatch",
            attemptCleared: true,
            channelOpen: false,
            peerBlacklisted: true
        });
    });

    it("an ordinary attempt whose channel ID the peer opens with another participant set and a hash no genesis derives from retries and blacklists the peer without aborting", async function () {
        const result = await fixture
            .probe()
            .probeForeignGenesisOpen("ordinary")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result).to.deep.equal({
            outcomeStatus: "retry",
            channelOpen: true,
            peerBlacklisted: true,
            runtimeDisposed: false,
            genesisInstalled: false
        });
    });

    it("a targeted attempt whose channel another participant set opens with a hash no genesis derives from hands off to the observed open without aborting", async function () {
        const result = await fixture
            .probe()
            .probeForeignGenesisOpen("targeted")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result).to.deep.equal({
            outcomeStatus: "observed-target-open",
            channelOpen: true,
            peerBlacklisted: false,
            runtimeDisposed: false,
            genesisInstalled: false
        });
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

    it("higher address derivation failure clears the attempt without co-signing or penalizing the proposer", async function () {
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

        expect(result.oldOutcome).to.equal("retry");
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

        expect(result.oldOutcome).to.equal("retry");
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

        expect(result.oldOutcome).to.equal("retry");
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

        expect(result.oldOutcome).to.equal("retry");
        expect(result.staleResult).to.equal("Opening data unavailable");
        expect(result.oldChannelOpen).to.equal(false);
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("lower address late genesis hash after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("lower", "resolve", "genesis")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.oldOutcome).to.equal("retry");
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.oldProposalFrames).to.equal(0);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("higher address late genesis hash after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("higher", "resolve", "genesis")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.oldOutcome).to.equal("retry");
        // the stale proposal's junk hash draws no mismatch verdict
        expect(result.staleResult).to.equal("submitted");
        expect(result.oldPeerBlacklisted).to.equal(false);
        expect(result.oldPeerStrikes).to.equal(0);
        expect(result.oldChannelOpen).to.equal(false);
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("lower address late genesis hook failure after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("lower", "reject", "genesis")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.oldOutcome).to.equal("retry");
        expect(result.replacementCurrent).to.equal(true);
        expect(result.replacementChannelKept).to.equal(true);
        expect(result.replacementTimeoutKept).to.equal(true);
        expect(result.replacementOutcomePending).to.equal(true);
        expect(result.oldProposalFrames).to.equal(0);
        expect(result.oldPeerBlacklisted).to.equal(false);
        expect(result.replacementOutcome).to.equal("opened");
        expect(result.replacementChannelOpen).to.equal(true);
    });

    it("higher address late genesis hook failure after cancellation keeps the replacement attempt", async function () {
        const result = await fixture
            .probe()
            .probeStaleDerivation("higher", "reject", "genesis")
            .request({ timeoutMs: fixture.openingTimeoutMs() });

        expect(result.oldOutcome).to.equal("retry");
        expect(result.staleResult).to.equal("Genesis unavailable");
        expect(result.oldPeerBlacklisted).to.equal(false);
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
