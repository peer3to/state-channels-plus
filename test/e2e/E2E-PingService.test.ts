import { expect } from "chai";

import { PingPongE2EFixture } from "@test/fixtures/PingPongE2EFixture";
import { waitFor } from "@test/utils/waitFor";

describe("E2E: PingPongService (custom RPC)", function () {
    let fixture: PingPongE2EFixture;

    beforeEach(function () {
        fixture = new PingPongE2EFixture();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("should let two peers call custom Ping/Pong RPC services", async function () {
        await fixture.setup(2);

        const { harness } = fixture;
        const peer0 = harness.getPeer(0);
        const peer1 = harness.getPeer(1);
        // The custom RPC services hang off the same loopback hostRpc as the
        // harness-control services; target peers by EVM address.
        const ctl = fixture.control.bind(fixture);

        // --- Fire-and-forget: peer 0 pings peer 1 (by address) ---
        ctl(peer0).pingService.ping("from-0").sendOne(peer1.address);
        await waitFor(
            async () =>
                (
                    await ctl(peer1)
                        .pingService.getReceivedPingNonces()
                        .request()
                ).includes("from-0") &&
                (
                    await ctl(peer0)
                        .pingService.getReceivedPongNonces()
                        .request()
                ).includes("from-0") &&
                (
                    await ctl(peer0)
                        .relayService.getReceivedRelayPingNonces()
                        .request()
                ).includes("from-0"),
            5000
        );

        // --- Fire-and-forget: peer 1 pings peer 0 ---
        ctl(peer1).pingService.ping("from-1").sendOne(peer0.address);
        await waitFor(
            async () =>
                (
                    await ctl(peer0)
                        .pingService.getReceivedPingNonces()
                        .request()
                ).includes("from-1") &&
                (
                    await ctl(peer1)
                        .pingService.getReceivedPongNonces()
                        .request()
                ).includes("from-1") &&
                (
                    await ctl(peer1)
                        .relayService.getReceivedRelayPingNonces()
                        .request()
                ).includes("from-1"),
            5000
        );

        // --- Request/response: peer 0 asks peer 1 to sum and gets a value back ---
        const sumResponse = await ctl(peer0)
            .pingService.sum(2, 3, "sum-0")
            .request(peer1.address);
        expect(sumResponse.sum).to.equal(5);
        expect(sumResponse.nonce).to.equal("sum-0");
        expect(sumResponse.requester?.toLowerCase()).to.equal(
            peer0.address.toLowerCase()
        );
        expect(
            await ctl(peer1).pingService.getReceivedSumNonces().request()
        ).to.include("sum-0");
        expect(
            (
                await ctl(peer1).pingService.getReceivedPingNonces().request()
            ).filter((nonce) => nonce === "from-0").length
        ).to.equal(1);
        expect(
            (
                await ctl(peer1).pingService.getReceivedSumNonces().request()
            ).filter((nonce) => nonce === "sum-0").length
        ).to.equal(1);
    });

    it("disconnects a peer that sends an inherited method name without affecting another session", async function () {
        await fixture.setup(3);

        const { harness } = fixture;
        const offender = harness.getPeer(0);
        const receiver = harness.getPeer(1);
        const bystander = harness.getPeer(2);
        const ctl = fixture.control.bind(fixture);

        await ctl(offender)
            .rpcHandlerProbe.sendRawRpc(
                receiver.address,
                "pingService",
                "toString"
            )
            .request();

        await harness.assert.rpc.peerDisconnectedFrom({
            peerIndex: receiver.index,
            expectedFinalCount: 1
        });
        expect(
            await ctl(receiver).pingService.getReceivedPingNonces().request()
        ).to.deep.equal([]);
        expect(
            await ctl(receiver).pingService.getReceivedSumNonces().request()
        ).to.deep.equal([]);

        ctl(receiver)
            .pingService.ping("after-rejection")
            .sendOne(bystander.address);
        await waitFor(
            async () =>
                (
                    await ctl(bystander)
                        .pingService.getReceivedPingNonces()
                        .request()
                ).includes("after-rejection") &&
                (
                    await ctl(receiver)
                        .pingService.getReceivedPongNonces()
                        .request()
                ).includes("after-rejection"),
            5000
        );
    });

    it("returns one response for an empty request id over the peer transport", async function () {
        await fixture.setup(2);

        const { harness } = fixture;
        const sender = harness.getPeer(0);
        const receiver = harness.getPeer(1);
        const ctl = fixture.control.bind(fixture);

        const response = await ctl(sender)
            .rpcHandlerProbe.sendEmptyIdRequestAndCaptureResponse(
                receiver.address
            )
            .request();

        expect(response.requestId).to.equal("");
        expect(response.ok).to.equal(true);
        expect(response.result).to.deep.equal({
            sum: 3,
            nonce: "empty-id-e2e",
            requester: sender.address
        });
        expect(
            await ctl(receiver).pingService.getReceivedSumNonces().request()
        ).to.deep.equal(["empty-id-e2e"]);
    });

    it("disconnects a multibyte oversized sender without affecting another session", async function () {
        await fixture.setup(3);

        const { harness } = fixture;
        const offender = harness.getPeer(0);
        const receiver = harness.getPeer(1);
        const bystander = harness.getPeer(2);
        const ctl = fixture.control.bind(fixture);

        await ctl(offender)
            .rpcHandlerProbe.sendMultibyteOversizedRpc(receiver.address)
            .request();

        await harness.assert.rpc.peerDisconnectedFrom({
            peerIndex: receiver.index,
            expectedFinalCount: 1
        });
        ctl(receiver)
            .pingService.ping("after-oversized-frame")
            .sendOne(bystander.address);
        await waitFor(
            async () =>
                (
                    await ctl(bystander)
                        .pingService.getReceivedPingNonces()
                        .request()
                ).includes("after-oversized-frame"),
            5000
        );
    });
});
