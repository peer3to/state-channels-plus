import { expect } from "chai";
import { Wallet } from "ethers";

import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("P2PManager", function () {
    let fixture: P2PManagerFixture | undefined;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture?.cleanup();
        fixture = undefined;
    });

    it("applies the frame-size, response, envelope, and service gates in order", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDispatchHead()
            .request();

        expect(result).to.deep.equal({
            oversizedDisconnected: true,
            exactLimitAccepted: true,
            malformedDisconnected: true,
            unknownServiceDisconnected: true,
            responseClassifiedBeforeDispatch: true
        });
    });

    it("accepts an exact-limit multibyte frame and rejects the first byte over", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeFrameByteBoundaries()
            .request();

        expect(result).to.deep.equal({
            multibyteExactAccepted: true,
            multibyteOverDisconnected: true,
            validJsonInvalidEnvelopeDisconnected: true
        });
    });

    it("keeps valid dispatches and disconnects false or throwing service dispatches", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDispatchOutcomes()
            .request();

        expect(result).to.deep.equal({
            validMethodStayedConnected: true,
            validMethodCalls: 1,
            unknownMethodDisconnected: true,
            throwingServiceDisconnected: true
        });
    });

    it("settles success, remote-error, default-error, and synchronous-send requests once", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeRequestSettlement()
            .request();

        expect(result).to.deep.equal({
            successValue: "accepted",
            remoteError: "remote failed",
            defaultRemoteError: "RPC request failed on the peer",
            sendError: "send failed",
            pendingCount: 0,
            timerCount: 0
        });
    });

    it("uses the agreement-time default or an explicit request timeout and releases both timers", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutSelection()
            .request();

        expect(result.defaultOutcome).to.contain("timed out after 20ms");
        expect(result.explicitOutcome).to.contain("timed out after 7ms");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("settles the response-timeout race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseTimeoutRace(true)
            .request();
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseTimeoutRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(timeoutFirst.firstOutcome).to.contain("timed out after 20ms");
        expect(responseFirst.secondFrameIgnored).to.equal(true);
        expect(timeoutFirst.secondFrameIgnored).to.equal(true);
        expect(responseFirst.connectionPresent).to.equal(true);
        expect(timeoutFirst.connectionPresent).to.equal(true);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
    });

    it("settles the remote-error-timeout race exactly once in both orders", async function () {
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorTimeoutRace(true)
            .request();
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorTimeoutRace(false)
            .request();

        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(timeoutFirst.firstOutcome).to.contain("timed out after 20ms");
        expect(errorFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
    });

    it("settles the response-remote-error race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseRemoteErrorRace(true)
            .request();
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseRemoteErrorRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(responseFirst.secondFrameIgnored).to.equal(true);
        expect(errorFirst.secondFrameIgnored).to.equal(true);
        expect(responseFirst.connectionPresent).to.equal(true);
        expect(errorFirst.connectionPresent).to.equal(true);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(errorFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
    });

    it("settles the response-disconnect race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseDisconnectRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(responseFirst.connectionPresent).to.equal(false);
        expect(disconnectFirst.connectionPresent).to.equal(false);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("settles the remote-error-disconnect race exactly once in both orders", async function () {
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorDisconnectRace(false)
            .request();

        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(errorFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("settles the timeout-disconnect race exactly once in both orders", async function () {
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutDisconnectRace(false)
            .request();

        expect(timeoutFirst.firstOutcome).to.contain("timed out after 15ms");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("uses distinct request IDs and settles concurrent responses once", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConcurrentSettlement()
            .request();

        expect(result.firstRequestId).to.not.equal(result.secondRequestId);
        expect(result.firstValue).to.equal("first");
        expect(result.secondValue).to.equal("second");
        expect(result.racedValue).to.equal("winner");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("rejects and releases every pending request during disposal", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisposal()
            .request();

        expect(result.outcomes).to.deep.equal([
            "Peer disconnected before RPC response arrived",
            "Peer disconnected before RPC response arrived"
        ]);
        expect(result.samePromise).to.equal(true);
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("cleans pending state and retains peer identity when transport close throws", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisconnectCleanup(fixture!.address(1))
            .request();

        expect(result.closeCalls).to.equal(1);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.profileTransportRetained).to.equal(true);
        expect(result.pendingError).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("rejects old-transport requests while keeping the replacement usable", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeTransportRetirement(fixture!.address(1))
            .request();

        expect(result.oldRequestError).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(result.oldConnectionRemoved).to.equal(true);
        expect(result.replacementConnected).to.equal(true);
        expect(result.replacementValue).to.equal("replacement-live");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("penalizes a foreign responder without settling the intended peer's request", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeForeignResponse(
                fixture!.address(0),
                fixture!.address(1)
            )
            .request();

        expect(result).to.deep.equal({
            foreignBlacklisted: true,
            foreignDisconnected: true,
            intendedValue: "intended"
        });
    });

    it("accepts replacement transports and ignores unknown or duplicate responses", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeRequestRegistry(fixture!.address(1))
            .request();

        expect(result.replacementValue).to.equal("replacement");
        expect(result.unknownResponseIgnored).to.equal(true);
        expect(result.duplicateResponseIgnored).to.equal(true);
        expect(result.pendingDisconnectErrors).to.deep.equal([
            "Peer disconnected before RPC response arrived",
            "Peer disconnected before RPC response arrived"
        ]);
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("deduplicates connections, broadcasts once, blacklists peers, and reports known addresses", async function () {
        const missingAddress = Wallet.createRandom().address;
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeLifecycle(
                fixture!.address(0),
                fixture!.address(1),
                missingAddress
            )
            .request();

        expect(result.broadcastCounts).to.deep.equal([1, 1, 1]);
        expect(result.duplicateAddCount).to.equal(1);
        expect(result.disconnectedCount).to.equal(2);
        expect(result.blacklistByTransport).to.equal(true);
        expect(result.blacklistByAddress).to.equal(true);
        expect(result.missingAddressIgnored).to.equal(true);
        expect(result.connectedPeers).to.deep.equal([
            fixture!.address(0),
            fixture!.address(1)
        ]);
        expect(result.discoveryWasNodeNoop).to.equal(true);
    });

    it("blacklists and disconnects every peer in a bulk penalty", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeBulkPenalty(
                fixture!.address(0),
                fixture!.address(1)
            )
            .request();

        expect(result.blacklisted).to.deep.equal([true, true]);
        expect(result.disconnected).to.deep.equal([true, true]);
    });

    it("uses profile fallback, deduplicates addresses, and omits unknown peers", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConnectedPeerFallback(fixture!.address(1))
            .request();

        expect(result.connectedPeers).to.deep.equal([fixture!.address(1)]);
    });
});
