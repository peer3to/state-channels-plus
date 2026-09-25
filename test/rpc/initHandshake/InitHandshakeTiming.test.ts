import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

/**
 * The handshake timing filters through the real endpoints: the responder's
 * request-time window, the initiator's response-time and round-trip windows,
 * and the acknowledgement timeout. Every failed check is clock skew or
 * silence, so it spends one retry strike and never a verdict.
 */
describe("InitHandshakeService timing filters", function () {
    let fixture: P2PManagerFixture;
    let agreementTime: number;
    const requestKey = `0x${"6a".repeat(32)}`;
    const responseKey = `0x${"6b".repeat(32)}`;
    const ackKey = `0x${"6c".repeat(32)}`;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
        agreementTime = await fixture
            .control()
            .handshake.getAgreementTime()
            .request();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("strikes an unauthenticated sender whose request time is ahead of the window", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeRequestSkew(
                requestKey,
                agreementTime + 1,
                null
            )
            .request();

        expect(result.threw).to.equal(true);
        expect(result.responded).to.equal(false);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.suspended).to.equal(false);
        expect(result.blacklisted).to.equal(false);
    });

    it("strikes an unauthenticated sender whose request time is behind the window", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeRequestSkew(
                requestKey,
                -(agreementTime + 1),
                null
            )
            .request();

        expect(result.threw).to.equal(true);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.blacklisted).to.equal(false);
    });

    it("signs a request whose time sits exactly on the upper window bound", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeRequestSkew(
                requestKey,
                agreementTime,
                null
            )
            .request();

        expect(result.responded).to.equal(true);
        expect(result.closed).to.equal(false);
        expect(result.strikes).to.equal(0);
    });

    it("signs a request whose time sits exactly on the lower window bound", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeRequestSkew(
                requestKey,
                -agreementTime,
                null
            )
            .request();

        expect(result.responded).to.equal(true);
        expect(result.closed).to.equal(false);
        expect(result.strikes).to.equal(0);
    });

    it("keys the request-skew strike by the EVM address of an authenticated sender", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeRequestSkew(
                requestKey,
                agreementTime + 1,
                fixture.address(1)
            )
            .request();

        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.suspended).to.equal(false);
        expect(result.blacklisted).to.equal(false);
    });

    it("suspends the sender key once its skewed requests reach the retry bound", async function () {
        const probe = () =>
            fixture
                .control()
                .p2pManagerProbe.probeHandshakeRequestSkew(
                    requestKey,
                    agreementTime + 1,
                    null
                )
                .request();
        const first = await probe();
        const second = await probe();
        const third = await probe();

        expect([first.strikes, second.strikes]).to.deep.equal([1, 2]);
        expect([first.suspended, second.suspended]).to.deep.equal([
            false,
            false
        ]);
        expect(third.closed).to.equal(true);
        expect(third.suspended).to.equal(true);
        expect(third.blacklisted).to.equal(false);
    });

    it("strikes a responder whose response time is ahead of the window", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "responseSkew",
                agreementTime + 1
            )
            .request();

        expect(result.acked).to.equal(false);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.suspended).to.equal(false);
        expect(result.blacklisted).to.equal(false);
    });

    it("strikes a responder whose response time is behind the window", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "responseSkew",
                -(agreementTime + 1)
            )
            .request();

        expect(result.acked).to.equal(false);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.blacklisted).to.equal(false);
    });

    it("accepts a response time exactly on the window bound", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "responseSkew",
                agreementTime
            )
            .request();

        expect(result.acked).to.equal(true);
        expect(result.closed).to.equal(false);
        expect(result.strikes).to.equal(0);
    });

    it("strikes a responder whose round trip exceeds the agreement time", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "roundTrip",
                agreementTime + 1
            )
            .request();

        expect(result.acked).to.equal(false);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.blacklisted).to.equal(false);
    });

    it("accepts a round trip exactly equal to the agreement time", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "roundTrip",
                agreementTime
            )
            .request();

        expect(result.acked).to.equal(true);
        expect(result.closed).to.equal(false);
        expect(result.strikes).to.equal(0);
    });

    it("strikes a responder that refuses the challenge instead of answering it", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "rejected",
                0
            )
            .request();

        expect(result.acked).to.equal(false);
        expect(result.closed).to.equal(true);
        expect(result.strikes).to.equal(1);
        expect(result.blacklisted).to.equal(false);
    });

    it("acknowledges a valid response and keeps the transport open", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeResponseTiming(
                responseKey,
                "valid",
                0
            )
            .request();

        expect(result.acked).to.equal(true);
        expect(result.closed).to.equal(false);
        expect(result.strikes).to.equal(0);
    });

    it("strikes the verified peer once when its acknowledgement never arrives", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeAckTimeout(ackKey, 1)
            .request();

        expect(result.strikesPerRound).to.deep.equal([1]);
        expect(result.keySuspended).to.equal(false);
        expect(result.verifiedAddressSuspended).to.equal(false);
    });

    it("suspends both the key and the verified address at the third missing acknowledgement", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHandshakeAckTimeout(ackKey, 3)
            .request();

        expect(result.strikesPerRound.slice(0, 2)).to.deep.equal([1, 2]);
        expect(result.keySuspended).to.equal(true);
        expect(result.verifiedAddressSuspended).to.equal(true);
    });
});
