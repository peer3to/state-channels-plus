import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

/**
 * Maps to: src/rpc/network/services/initHandshake/InitHandshakeService.ts
 *
 * The handshake filters out peers it cannot agree a clock with. That is not a
 * fault, so the outcome is a session-scoped suspension — closed and not
 * redialled — instead of a blacklist. The request leg can end four ways and
 * only two of them leave a peer to suspend.
 */
describe("InitHandshake suspension policy", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("suspends a verified peer whose handshake ack never arrives", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeAckTimeoutAfterVerifiedAddress()
            // The probe waits out the handshake ack timeout (the agreement
            // window) before reading the outcome, which outlasts the default
            // request budget of this control call.
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.profileSuspended).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });

    it("suspends a peer that never answers the handshake challenge", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeRequestTimeout()
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.profileSuspended).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });

    it("suspends a peer that refuses the handshake challenge", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeRefusedRequest()
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.profileSuspended).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });

    it("sends the skew refusal before closing the connection", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeSkewedRequestRefusedBeforeClose()
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.refusalFrameIndex).to.be.greaterThan(-1);
        // The peer must be able to read why we refused, so the error response
        // has to be on the wire before the close.
        expect(result.refusalFrameIndex).to.be.lessThan(
            result.writesAtDestroy ?? -1
        );
        expect(result.profileSuspended).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(false);
    });

    it("suspends nothing when the connection is gone before the response", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeTransportClosedDuringRequest()
            .request({ timeoutMs: 30_000 });

        expect(result.profileSuspended).to.equal(false);
        expect(result.banCalls).to.deep.equal([]);
        expect(result.socketDestroyed).to.equal(false);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });
});
