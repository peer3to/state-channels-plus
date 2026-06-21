import { expect } from "chai";
import { MathStateMachine } from "@typechain-types";
import path from "node:path";

import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import { waitFor } from "@test/utils/waitFor";

describe("E2E: PingPongService (custom RPC)", function () {
    let harness: PeerTestHarness<PingPongRpc, MathStateMachine> | undefined;

    afterEach(async function () {
        await harness?.cleanup();
        harness = undefined;
    });

    it("should let two peers call custom Ping/Pong RPC services", async function () {
        harness = new PeerTestHarness<PingPongRpc, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });

        await harness.setup(2, {
            autoConnect: false,
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "../fixtures/customRpc/PingPongRpcManifest.ts"
                )
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });
        await harness.lifecycle.openChannel();
        await harness.rpc.connectPeers([0, 1]);
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        const peer0 = harness.getPeer(0);
        const peer1 = harness.getPeer(1);
        // The custom RPC services hang off the same loopback hostRpc as the
        // harness-control services; target peers by EVM address.
        const ctl = (p: typeof peer0) =>
            harness!.control(p) as unknown as RemoteRpcProxyType<PingPongRpc>;

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
    });
});
