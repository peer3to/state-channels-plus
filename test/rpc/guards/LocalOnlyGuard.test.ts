import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import {
    LOCAL_ONLY_REASON,
    PEER_DISCONNECTED_ERROR
} from "@test/fixtures/LocalOnlyGuardE2EFixture";
import { LocalOnlyGuardFixture } from "@test/fixtures/LocalOnlyGuardFixture";
import { expect } from "chai";

describe("LocalOnlyGuard", function () {
    let fixture: LocalOnlyGuardFixture;

    beforeEach(function () {
        fixture = new LocalOnlyGuardFixture();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("lets a trusted loopback call run its endpoint once without punishment", async function () {
        await fixture.setupConnected();
        const [receiver] = fixture.harness.peers;

        const { result, observation } = await fixture.observe(receiver, () =>
            fixture
                .control(receiver)
                .localOnlyGuardTarget.record("loopback")
                .request()
        );

        expect(result).to.equal("loopback");
        expect(observation.invocations).to.deep.equal(["loopback"]);
        expect(
            observation.deliveries.map((delivery) => delivery.trusted)
        ).to.deep.equal([true]);
        expect(observation.disconnects).to.deep.equal([]);
        expect(observation.verdicts).to.equal(0);
    });

    it("blacklists and disconnects an authenticated remote request without a failure response", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;

        const { result: outcome, observation } = await fixture.observe(
            receiver,
            async () => {
                const outcome = await fixture.remoteRequestOutcome(
                    caller,
                    receiver,
                    "remote-request"
                );
                await fixture.expectPunished(receiver, caller);
                return outcome;
            }
        );

        // Settled by the receiver closing the transport, not by a response.
        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.request).to.equal(true);
        expect(delivery.proven).to.equal(true);
        expect(delivery.profile).to.equal(true);
        expect(delivery.profileBlacklisted).to.equal(true);
        expect(delivery.transportClosed).to.equal(true);
        expect(delivery.transportOpen).to.equal(false);
        expect(delivery.localOnlySuppressed).to.equal(true);
        // No response attempt reached the dispatcher or the real transport.
        expect(delivery.responseAttempts).to.equal(0);
        expect(delivery.responseFrames).to.deep.equal([]);
        expect(observation.responseSendErrors).to.equal(0);
        expect(observation.dispatchErrors).to.equal(0);
        expect(observation.invocations).to.deep.equal([]);
        expect(observation.verdicts).to.equal(1);
        // One canonical disconnect; no response-path disconnect follows it.
        expect(
            observation.disconnects.filter(
                (call) => call.origin !== "close-bookkeeping"
            )
        ).to.deep.equal([
            { tier: "BLACKLIST", reason: LOCAL_ONLY_REASON, origin: "direct" }
        ]);
        // The closed transport's own bookkeeping only states ALLOW.
        const bookkeeping = observation.disconnects.filter(
            (call) => call.origin === "close-bookkeeping"
        );
        expect(bookkeeping).to.not.deep.equal([]);
        expect(bookkeeping.every((call) => call.tier === "ALLOW")).to.equal(
            true
        );
    });

    it("blacklists and disconnects an authenticated remote notification without executing it", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;

        const { observation } = await fixture.observe(receiver, async () => {
            fixture
                .control(caller)
                .localOnlyGuardTarget.notify("remote-notification")
                .sendOne(receiver.address);
            await fixture.expectPunished(receiver, caller);
        });

        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.request).to.equal(false);
        expect(delivery.proven).to.equal(true);
        expect(delivery.profileBlacklisted).to.equal(true);
        expect(observation.verdicts).to.equal(1);
        fixture.expectRejectedWithoutResponse(observation);
    });

    it("rejects a negotiating transport with a registered profile at once and never replays it", async function () {
        await fixture.setupNegotiating();
        const [receiver, caller] = fixture.harness.peers;

        const { result: outcome, observation } = await fixture.observe(
            receiver,
            () => fixture.sendBeforeHandshake("negotiating")
        );
        // Let the held handshake run; the rejected call is not replayed.
        await fixture.control(receiver).stub.releaseInitHandshakes().request();

        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.proven).to.equal(false);
        expect(delivery.negotiating).to.equal(true);
        expect(delivery.profile).to.equal(true);
        expect(delivery.profileBlacklisted).to.equal(true);
        expect(observation.handshakeWaits).to.equal(0);
        fixture.expectRejectedWithoutResponse(observation);
        // The pre-handshake profile has no proven address to record.
        expect(observation.verdicts).to.equal(0);
        expect(
            await fixture
                .control(receiver)
                .query.isBlacklisted(caller.address)
                .request()
        ).to.equal(false);
        expect(await fixture.invocations(receiver)).to.deep.equal([]);
    });

    it("closes a transport with neither a profile nor a proven address without recording a verdict", async function () {
        await fixture.setupNegotiating();
        const [receiver, caller] = fixture.harness.peers;
        const stub = fixture.control(receiver).stub;

        expect(
            await stub.stubUnregisterHeldHandshakeProfiles().request()
        ).to.be.greaterThan(0);
        const { result: outcome, observation } = await fixture
            .observe(receiver, () => fixture.sendBeforeHandshake("addressless"))
            .finally(async () => {
                await stub.restoreUnregisteredProfiles().request();
                await stub.releaseInitHandshakes().request();
            });

        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.proven).to.equal(false);
        expect(delivery.profile).to.equal(false);
        fixture.expectRejectedWithoutResponse(observation);
        expect(observation.verdicts).to.equal(0);
        const query = fixture.control(receiver).query;
        expect(await query.isBlacklisted(caller.address).request()).to.equal(
            false
        );
        expect(await query.isSuspended(caller.address).request()).to.equal(
            false
        );
        // Nothing bars the caller: the two peers connect and authenticate again.
        await fixture.harness.network.connectPeers([0, 1]);
        await fixture.harness.network.waitForP2PConnections();
        expect(await query.isConnectedTo(caller.address).request()).to.equal(
            true
        );
    });

    it("records an address verdict for a proven address that has no profile", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;
        const stub = fixture.control(receiver).stub;

        expect(
            await stub.stubUnregisterPeerProfile(caller.address).request()
        ).to.equal(true);
        const { result: outcome, observation } = await fixture
            .observe(receiver, async () => {
                const outcome = await fixture.remoteRequestOutcome(
                    caller,
                    receiver,
                    "proven-address"
                );
                await fixture.expectPunished(receiver, caller);
                return outcome;
            })
            .finally(() => stub.restoreUnregisteredProfiles().request());

        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.proven).to.equal(true);
        expect(delivery.profile).to.equal(false);
        expect(observation.verdicts).to.equal(1);
        fixture.expectRejectedWithoutResponse(observation);
    });

    it("suppresses the response when an earlier guard passes and the local-only guard rejects", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;

        const { result: outcome, observation } = await fixture.observe(
            receiver,
            async () => {
                const outcome = await fixture.remoteChainOutcome(
                    caller,
                    receiver,
                    "passEarlierGuard",
                    "chain"
                );
                await fixture.expectPunished(receiver, caller);
                return outcome;
            }
        );

        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.earlierGuardFailures).to.equal(0);
        expect(
            observation.deliveries.map(
                (delivery) => delivery.localOnlySuppressed
            )
        ).to.deep.equal([true]);
        fixture.expectRejectedWithoutResponse(observation);
    });

    it("keeps an earlier failing guard's rejection response unchanged", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;

        const { result: outcome, observation } = await fixture.observe(
            receiver,
            () =>
                fixture.remoteChainOutcome(
                    caller,
                    receiver,
                    "failEarlierGuard",
                    "chain"
                )
        );

        expect(outcome).to.equal(RPC_GUARD_REJECTION_ERROR);
        expect(observation.earlierGuardFailures).to.equal(1);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.localOnlySuppressed).to.equal(false);
        expect(delivery.responseAttempts).to.equal(1);
        expect(
            delivery.responseFrames.map(({ ok, error }) => ({ ok, error }))
        ).to.deep.equal([{ ok: false, error: RPC_GUARD_REJECTION_ERROR }]);
        expect(delivery.transportClosed).to.equal(false);
        expect(observation.responseSendErrors).to.equal(0);
        expect(observation.disconnects).to.deep.equal([]);
        expect(observation.invocations).to.deep.equal([]);
        expect(
            await fixture
                .control(receiver)
                .query.isConnectedTo(caller.address)
                .request()
        ).to.equal(true);
    });

    it("marks only the request it rejected as suppressed", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;

        const { result: outcomes, observation } = await fixture.observe(
            receiver,
            async () => {
                const foreign = await fixture.remoteChainOutcome(
                    caller,
                    receiver,
                    "failEarlierGuard",
                    "foreign"
                );
                const rejected = await fixture.remoteChainOutcome(
                    caller,
                    receiver,
                    "passEarlierGuard",
                    "rejected"
                );
                await fixture.expectPunished(receiver, caller);
                return [foreign, rejected];
            }
        );

        expect(outcomes).to.deep.equal([
            RPC_GUARD_REJECTION_ERROR,
            PEER_DISCONNECTED_ERROR
        ]);
        expect(
            observation.deliveries.map(({ value, localOnlySuppressed }) => ({
                value,
                localOnlySuppressed
            }))
        ).to.deep.equal([
            { value: "foreign", localOnlySuppressed: false },
            { value: "rejected", localOnlySuppressed: true }
        ]);
    });

    it("rejects overlapping calls and a call on the retired transport without executing or deferring", async function () {
        await fixture.setupConnected();
        const [receiver, caller] = fixture.harness.peers;
        const stub = fixture.control(receiver).stub;

        await stub
            .stubCaptureInboundRequestFrames("localOnlyGuardTarget")
            .request();
        const { result, observation } = await fixture
            .observe(receiver, async () => {
                const outcomes = await Promise.all([
                    fixture.remoteRequestOutcome(caller, receiver, "overlap-1"),
                    fixture.remoteRequestOutcome(caller, receiver, "overlap-2")
                ]);
                await fixture.expectPunished(receiver, caller);
                // Replay the caller's first frame on the retired connection.
                const retired = await stub
                    .injectCapturedRequestFrame(0)
                    .request();
                return { outcomes, retired };
            })
            .finally(() => stub.restoreInboundRequestFrames().request());

        expect(result.outcomes).to.deep.equal([
            PEER_DISCONNECTED_ERROR,
            PEER_DISCONNECTED_ERROR
        ]);
        expect(result.retired.transportClosed).to.equal(true);
        expect(observation.deliveries.length).to.be.at.least(2);
        for (const delivery of observation.deliveries)
            expect(delivery.profileBlacklisted).to.equal(true);
        expect(observation.handshakeWaits).to.equal(0);
        fixture.expectRejectedWithoutResponse(observation);
        // One canonical rejection per delivery, none deferred.
        expect(
            observation.disconnects.filter((call) => call.origin === "direct")
        ).to.have.length(observation.deliveries.length);
        expect(await fixture.invocations(receiver)).to.deep.equal([]);
    });
});
