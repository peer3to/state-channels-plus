import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

/**
 * Maps to: src/rpc/network/services/initHandshake/InitHandshakeService.ts
 *
 * The catch around the handshake challenge request used to call every
 * rejection a response timeout and always disconnect. The router now tags each
 * rejection with its cause, and only a transport that is already gone needs no
 * disconnect. None of these is misbehaviour, so nothing is blacklisted.
 */
describe("InitHandshake request failure handling", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("closes the transport of a peer that never answers the handshake challenge", async function () {
        const result = await fixture
            .control()
            .initHandshakeRequestFailureProbe.probeRequestTimeout()
            // The probe waits out the handshake request timeout (the agreement
            // window), which outlasts the default budget of this control call.
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.banCalls).to.deep.equal([]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });

    it("closes the transport of a peer that answers the challenge with an error", async function () {
        const result = await fixture
            .control()
            .initHandshakeRequestFailureProbe.probeRemoteError()
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(true);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.banCalls).to.deep.equal([]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });

    it("closes nothing when the connection is already gone before the response", async function () {
        const result = await fixture
            .control()
            .initHandshakeRequestFailureProbe.probeTransportClosedDuringRequest()
            .request({ timeoutMs: 30_000 });

        expect(result.socketDestroyed).to.equal(false);
        expect(result.connectionRemoved).to.equal(false);
        expect(result.banCalls).to.deep.equal([]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.identityBlacklisted).to.equal(false);
    });
});
