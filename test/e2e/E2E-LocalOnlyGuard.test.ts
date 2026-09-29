import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import {
    LocalOnlyGuardE2EFixture,
    PEER_DISCONNECTED_ERROR
} from "@test/fixtures/LocalOnlyGuardE2EFixture";
import { expect } from "chai";

describe("E2E: LocalOnlyGuard", function () {
    let fixture: LocalOnlyGuardE2EFixture;

    beforeEach(function () {
        fixture = new LocalOnlyGuardE2EFixture();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("runs a local call and blacklists and disconnects a remote requester with no response", async function () {
        await fixture.setup(2);
        const [receiver, offender] = fixture.harness.peers;

        expect(
            await fixture
                .control(receiver)
                .localOnlyGuardTarget.record("local")
                .request()
        ).to.equal("local");
        const { result: outcome, observation } = await fixture.observe(
            receiver,
            async () => {
                const outcome = await fixture.remoteRequestOutcome(
                    offender,
                    receiver,
                    "remote"
                );
                await fixture.expectPunished(receiver, offender);
                return outcome;
            }
        );

        fixture.expectNoGuardResponse(outcome);
        // Settled by the receiver closing the transport, with no response attempt.
        expect(outcome).to.equal(PEER_DISCONNECTED_ERROR);
        expect(observation.deliveries).to.have.length(1);
        fixture.expectRejectedWithoutResponse(observation);
        expect(await fixture.invocations(receiver)).to.deep.equal(["local"]);
    });

    it("still sends an earlier guard's rejection response to a remote requester and keeps it connected", async function () {
        await fixture.setup(2);
        const [receiver, requester] = fixture.harness.peers;

        const { result: outcome, observation } = await fixture.observe(
            receiver,
            () =>
                fixture.remoteChainOutcome(
                    requester,
                    receiver,
                    "failEarlierGuard",
                    "remote"
                )
        );

        expect(outcome).to.equal(RPC_GUARD_REJECTION_ERROR);
        expect(observation.deliveries).to.have.length(1);
        const [delivery] = observation.deliveries;
        expect(delivery.responseAttempts).to.equal(1);
        expect(
            delivery.responseFrames.map(({ ok, error }) => ({ ok, error }))
        ).to.deep.equal([{ ok: false, error: RPC_GUARD_REJECTION_ERROR }]);
        expect(observation.responseSendErrors).to.equal(0);
        expect(observation.disconnects).to.deep.equal([]);
        expect(observation.invocations).to.deep.equal([]);
        expect(
            await fixture
                .control(receiver)
                .query.isConnectedTo(requester.address)
                .request()
        ).to.equal(true);
        expect(
            await fixture
                .control(receiver)
                .query.isBlacklisted(requester.address)
                .request()
        ).to.equal(false);
    });

    it("blacklists and disconnects a remote notification sender without executing it", async function () {
        await fixture.setup(2);
        const [receiver, offender] = fixture.harness.peers;

        fixture
            .control(offender)
            .localOnlyGuardTarget.notify("notification")
            .sendOne(receiver.address);

        await fixture.expectPunished(receiver, offender);
        expect(await fixture.invocations(receiver)).to.deep.equal([]);
    });

    it("rejects a call over a transport still negotiating its handshake and never replays it", async function () {
        const harness = fixture.harness;
        await harness.lifecycle.start(2, 0, {
            autoConnect: false,
            customRpcManifest: fixture.customRpcManifest(),
            timeConfig: fixture.timeConfig()
        });
        const [sender, receiver] = harness.peers;
        await fixture
            .control(receiver)
            .stub.stubBlockHandshakeAndRecordSpectateGuard()
            .request();
        await fixture
            .control(sender)
            .stub.stubCaptureInitHandshakeTransport()
            .request();
        await harness.network.connectPeers([0, 1]);
        await fixture.waitForCapturedHandshakeTransport(sender);

        const outcome = await fixture
            .control(sender)
            .localOnlyGuardProbe.sendOverCapturedHandshakeTransport(
                "negotiating",
                harness.event.protocolEventTimeoutMs()
            )
            .request();
        await fixture
            .control(receiver)
            .stub.restoreBlockedHandshake()
            .request();

        fixture.expectNoGuardResponse(outcome);
        // Settled by the receiver closing the transport, not by the timeout.
        expect(outcome).to.not.match(/timed out/);
        expect(
            await fixture
                .control(sender)
                .localOnlyGuardProbe.isCapturedHandshakeTransportClosed()
                .request()
        ).to.equal(true);
        // The address is unproven before the handshake: the receiver only
        // closes the transport and records nothing against the claimed address.
        expect(
            await fixture
                .control(receiver)
                .query.isBlacklisted(sender.address)
                .request()
        ).to.equal(false);
        expect(await fixture.invocations(receiver)).to.deep.equal([]);
    });

    it("keeps a recorded blacklist through reconnect attempts while an unrelated peer stays connected", async function () {
        await fixture.setup(3);
        const [receiver, offender, bystander] = fixture.harness.peers;

        fixture.expectNoGuardResponse(
            await fixture.remoteRequestOutcome(offender, receiver, "remote")
        );
        await fixture.expectPunished(receiver, offender);
        await fixture.harness.network.connectPeers([0, 1]);
        // Absence window: one p2p period for discovery to try the offender again.
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        expect(
            await fixture
                .control(receiver)
                .query.isConnectedTo(offender.address)
                .request()
        ).to.equal(false);
        expect(
            await fixture
                .control(receiver)
                .query.isBlacklisted(offender.address)
                .request()
        ).to.equal(true);
        expect(
            await fixture
                .control(receiver)
                .query.isConnectedTo(bystander.address)
                .request()
        ).to.equal(true);
        const sum = await fixture
            .control(bystander)
            .pingService.sum(2, 3, "bystander")
            .request(receiver.address);
        expect(sum.sum).to.equal(5);
        expect(await fixture.invocations(receiver)).to.deep.equal([]);
    });

    it("completes an overlapping local call while the remote call is barred", async function () {
        await fixture.setup(2);
        const [receiver, offender] = fixture.harness.peers;

        const [local, remote] = await Promise.all([
            fixture
                .control(receiver)
                .localOnlyGuardTarget.record("local")
                .request(),
            fixture.remoteRequestOutcome(offender, receiver, "remote")
        ]);

        expect(local).to.equal("local");
        fixture.expectNoGuardResponse(remote);
        await fixture.expectPunished(receiver, offender);
        expect(await fixture.invocations(receiver)).to.deep.equal(["local"]);
    });
});
