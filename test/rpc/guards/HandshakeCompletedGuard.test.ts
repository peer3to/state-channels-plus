import { expect } from "chai";

import { HandshakeCompletedGuardFixture } from "@test/fixtures/HandshakeCompletedGuardFixture";

describe("HandshakeCompletedGuard", function () {
    let fixture: HandshakeCompletedGuardFixture;

    beforeEach(async function () {
        fixture = new HandshakeCompletedGuardFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("passes a transport with a completed peer profile", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeCompleted()
            .request();

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["completed"]);
    });

    it("queues fire-and-forget calls behind one waiter and replays them in order", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeQueueReplay()
            .request();

        expect(result.waitCalls).to.equal(1);
        expect(result.beforeCompletion).to.deep.equal([]);
        expect(result.afterCompletion).to.deep.equal(["first", "second"]);
    });

    it("pins the current immediate guard error and dead request replay contradiction", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeRequestDuringNegotiation()
            .request();

        expect(result.immediateResponses).to.have.length(1);
        const requestId = result.immediateResponses[0].requestId;
        expect(result.immediateResponses[0]).to.deep.equal({
            rpcResponse: true,
            requestId,
            ok: false,
            error: "RPC request rejected by guard"
        });
        expect(result.finalResponses).to.have.length(2);
        expect(result.finalResponses[1]).to.deep.equal({
            rpcResponse: true,
            requestId,
            ok: true,
            result: "request"
        });
        expect(result.invocations).to.deep.equal(["request"]);
        expect(result.callerError).to.equal("RPC request rejected by guard");
    });

    it("disconnects and blacklists a non-negotiating unverified peer", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeNonNegotiatingPunishment()
            .request();

        expect(result.blacklisted).to.equal(true);
        expect(result.disconnected).to.equal(true);
        expect(result.invocations).to.deep.equal([]);
    });

    it("clears a timed-out queue and starts a fresh waiter for a later call", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeTimeoutAndFreshWaiter()
            .request();

        expect(result.waitCalls).to.equal(2);
        expect(result.timeoutMs).to.deep.equal([
            result.expectedTimeoutMs,
            result.expectedTimeoutMs
        ]);
        expect(result.firstBlacklisted).to.equal(true);
        expect(result.firstDisconnected).to.equal(true);
        expect(result.invocations).to.deep.equal(["fresh"]);
    });

    it("isolates queues and waiters between transports", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeQueueIsolation()
            .request();

        expect(result.waitCalls).to.deep.equal([1, 1]);
        expect(result.afterFirstCompletion).to.deep.equal(["first-transport"]);
        expect(result.finalInvocations).to.deep.equal(["first-transport"]);
        expect(result.firstConnected).to.equal(true);
        expect(result.secondDisconnected).to.equal(true);
    });

    it("rejects missing profiles through both addressless punishment branches", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeAddresslessFallback()
            .request();

        expect(result.nonNegotiatingDisconnected).to.equal(true);
        expect(result.timeoutDisconnected).to.equal(true);
        expect(result.invocations).to.deep.equal([]);
    });

    it("uses a custom failure handler without built-in punishment", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeCustomFailure()
            .request();

        expect(result.failureCalls).to.equal(1);
        expect(result.disconnected).to.equal(false);
        expect(result.invocations).to.deep.equal([]);
    });
});
