import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

/**
 * Maps to: src/rpc/network/services/initHandshake/InitHandshakeService.ts
 *
 * The disconnect tier of the two handshake outcomes that are not observable
 * end to end: a verified peer whose ack never arrives (a timeout, never a
 * fault) and an already-excluded identity that dials back (an exclusion that
 * must be re-applied to the arriving connection).
 */
describe("InitHandshake disconnect policy", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("closes a verified peer whose handshake ack times out without excluding it", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeAckTimeoutAfterVerifiedAddress()
            // The probe waits out the handshake ack timeout (the agreement
            // window) before reading the outcome, which outlasts the default
            // request budget of this control call.
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.identityBlacklisted).to.equal(false);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.banCalls).to.deep.equal([]);
    });

    it("re-bans an excluded identity that answers a handshake on a new connection", async function () {
        const result = await fixture
            .control()
            .initHandshakePolicyProbe.probeBlacklistedResponseSigner()
            // Same reason as above: the probe stages two connections and waits
            // on protocol timeouts between them.
            .request({ timeoutMs: 30_000 });

        expect(result.identityBlacklistedBefore).to.equal(true);
        expect(result.profileBlacklisted).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
    });
});
