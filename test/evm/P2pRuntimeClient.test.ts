import { expect } from "chai";
import { ethers } from "hardhat";
import { MessageChannel } from "node:worker_threads";
import { StateChannelManagerProxy__factory } from "@typechain-types";

import P2pRuntimeClient from "@/evm/p2pRuntime/P2pRuntimeClient";
import { serializeError } from "@/rpc/serializeError";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import type { RuntimePort } from "@/transport/RuntimePort";
import { fakeHost } from "@test/fixtures/p2pRuntime/fakeHost.fixture";
import { waitFor } from "@test/utils/waitFor";

function clientOver(
    port: RuntimePort,
    webRTCBridgeCandidate?: MessagePort
): P2pRuntimeClient {
    const signer = ethers.Wallet.createRandom();
    return new P2pRuntimeClient(port, {
        signerAddress: signer.address,
        scm: {
            address: ethers.Wallet.createRandom().address,
            abiJson:
                StateChannelManagerProxy__factory.createInterface().formatJson()
        },
        stateMachine: {
            address: ethers.Wallet.createRandom().address,
            abiJson: "[]"
        },
        provider: ethers.provider,
        webRTCBridgeCandidate
    });
}

/** the client's side of readiness and the bridge port, against a host that
 *  answers by hand */
describe("P2pRuntimeClient", function () {
    it("keeps the bridge candidate when the host registered the bridge", async function () {
        const channel = createRuntimeChannel();
        const bridge = new MessageChannel();
        const client = clientOver(
            channel.port1,
            bridge.port1 as unknown as MessagePort
        );
        fakeHost(channel.port2, (rpc) =>
            rpc.method === "deployComplete"
                ? { ok: true, result: { webRTCBridge: true } }
                : undefined
        );

        try {
            await client.deployComplete("0x01", "0x02");
            await client.ready;

            expect(client.webRTCBridgePort).to.equal(bridge.port1);
        } finally {
            await client.dispose();
            bridge.port1.close();
            bridge.port2.close();
            channel.port2.close();
        }
    });

    it("closes the bridge candidate when the host negotiates WebRTC itself", async function () {
        const channel = createRuntimeChannel();
        const bridge = new MessageChannel();
        let closed = false;
        bridge.port2.on("close", () => {
            closed = true;
        });
        const client = clientOver(
            channel.port1,
            bridge.port1 as unknown as MessagePort
        );
        fakeHost(channel.port2, (rpc) =>
            rpc.method === "deployComplete"
                ? { ok: true, result: { webRTCBridge: false } }
                : undefined
        );

        try {
            await client.deployComplete("0x01", "0x02");

            expect(client.webRTCBridgePort).to.equal(undefined);
            // the far port learns of the close on its own message loop
            await waitFor(() => closed, 2000);
        } finally {
            await client.dispose();
            bridge.port2.close();
            channel.port2.close();
        }
    });

    it("a host error pushed before deployComplete rejects ready with it", async function () {
        const channel = createRuntimeChannel();
        const client = clientOver(channel.port1);
        const host = fakeHost(channel.port2, () => undefined);

        host.push({
            service: "runtimeEvents",
            method: "hostError",
            params: [serializeError(new Error("provider exploded"))]
        });

        let caught: Error | undefined;
        try {
            await client.ready;
        } catch (error) {
            caught = error as Error;
        }
        expect(caught?.message).to.equal("provider exploded");
        await client.dispose();
        channel.port2.close();
    });

    it("a failed deployComplete rejects with the host's error and its data", async function () {
        const channel = createRuntimeChannel();
        const client = clientOver(channel.port1);
        const revert = new Error("root ready boom") as Error & { data: string };
        revert.data = "0xabcd";
        fakeHost(channel.port2, (rpc) =>
            rpc.method === "deployComplete"
                ? { ok: false, error: serializeError(revert) }
                : undefined
        );

        let caught: (Error & { data?: string }) | undefined;
        try {
            await client.deployComplete("0x01", "0x02");
        } catch (error) {
            caught = error as Error & { data?: string };
        }
        expect(caught?.message).to.equal("root ready boom");
        expect(caught?.data).to.equal("0xabcd");
        await client.dispose();
        channel.port2.close();
    });
});
