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

    it("rejects unauthenticated profiles through both addressless punishment branches", async function () {
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

    it("drops queued calls when their transport retires before authentication completes", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeRetiredTransportCompletion()
            .request();

        expect(result.waitCalls).to.equal(1);
        expect(result.invocations).to.deep.equal(["replacement"]);
        expect(result.retiredClosed).to.equal(true);
        expect(result.retiredRegistered).to.equal(false);
        expect(result.retiredBlacklisted).to.equal(false);
        expect(result.replacementCurrent).to.equal(true);
    });

    it("drops queued calls when a disposed owner receives late authentication success", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeDisposedWaiter(true)
            .request();

        expect(result.invocations).to.deep.equal([]);
        expect(result.blacklisted).to.equal(false);
        expect(result.closeCalls).to.equal(1);
        expect(result.responses).to.deep.equal([]);
        expect(result.managerDisposed).to.equal(true);
    });

    it("does not punish after a disposed owner's authentication waiter fails", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeDisposedWaiter(false)
            .request();

        expect(result.invocations).to.deep.equal([]);
        expect(result.blacklisted).to.equal(false);
        expect(result.closeCalls).to.equal(1);
        expect(result.responses).to.deep.equal([]);
        expect(result.managerDisposed).to.equal(true);
    });

    it("does not revive a timed-out queue after late authentication", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeLateCompletionAfterTimeout()
            .request();

        expect(result.waitCalls).to.equal(2);
        expect(result.invocations).to.deep.equal(["replacement"]);
        expect(result.originalBlacklisted).to.equal(true);
        expect(result.originalDisconnected).to.equal(true);
        expect(result.replacementConnected).to.equal(true);
    });

    it("allows guarded RPCs on an authenticated transport during replacement grace", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeAuthenticatedGraceOverlap()
            .request();

        expect(result.invocations).to.deep.equal(["original-live"]);
        expect(result.originalClosed).to.equal(false);
        expect(result.replacementClosed).to.equal(false);
        expect(result.originalAuthenticated).to.equal(true);
        expect(result.replacementCurrent).to.equal(true);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.activeConnections).to.equal(2);
    });

    it("releases a queued RPC only when its exact transport authenticates", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeExactTransportQueueOwnership()
            .request();

        expect(result.beforeAuthentication).to.deep.equal([]);
        expect(result.afterReplacementAuthentication).to.deep.equal([]);
        expect(result.finalInvocations).to.deep.equal([
            "original-first",
            "original-second"
        ]);
        expect(result.originalAuthenticated).to.equal(true);
        expect(result.replacementAuthenticated).to.equal(true);
        expect(result.originalCurrent).to.equal(true);
        expect(result.profileBlacklisted).to.equal(false);
    });

    it("drops a late frame dispatched after its authenticated transport closes", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeClosedTransportDispatch()
            .request();

        expect(result.invocations).to.deep.equal([]);
        expect(result.originalClosed).to.equal(true);
        expect(result.replacementClosed).to.equal(false);
        expect(result.replacementConnected).to.equal(true);
        expect(result.profileBlacklisted).to.equal(false);
    });
});
