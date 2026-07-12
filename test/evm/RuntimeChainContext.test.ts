import { expect } from "chai";
import { ethers } from "hardhat";
import { WebSocketProvider } from "ethers";
import sinon from "sinon";
import { StateChannelManagerProxy__factory } from "@typechain-types";

import { resolveWebSocketProviderUrl } from "@/evm/p2pRuntime/RuntimeChainContext";
import { startP2pRuntimeHost } from "@/evm/p2pRuntime/P2pRuntimeHost";
import P2pRuntimeClient from "@/evm/p2pRuntime/P2pRuntimeClient";
import Clock from "@/Clock";
import { createConfig } from "@/utils/config";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";

describe("RuntimeChainContext", () => {
    it("accepts WebSocket URLs and optimistically converts HTTP URLs", () => {
        expect(resolveWebSocketProviderUrl("ws://localhost:8545")).to.equal(
            "ws://localhost:8545"
        );
        expect(resolveWebSocketProviderUrl("wss://rpc.example/ws")).to.equal(
            "wss://rpc.example/ws"
        );
        expect(resolveWebSocketProviderUrl("http://localhost:8545")).to.equal(
            "ws://localhost:8545"
        );
        expect(
            resolveWebSocketProviderUrl("https://rpc.example/http")
        ).to.equal("wss://rpc.example/http");
    });

    it("rejects non-WebSocket-compatible provider URLs", () => {
        expect(() =>
            resolveWebSocketProviderUrl("ipc:///tmp/node.ipc")
        ).to.throw("requires a ws:// or wss:// WebSocket provider URL");
    });

    it("destroys the host provider and reports the original startup error", async () => {
        await Clock.init(ethers.provider);
        const channel = createRuntimeChannel();
        const signer = ethers.Wallet.createRandom();
        const scm = {
            address: ethers.Wallet.createRandom().address,
            abiJson:
                StateChannelManagerProxy__factory.createInterface().formatJson()
        };
        const stateMachine = {
            address: ethers.Wallet.createRandom().address,
            abiJson: "[]"
        };
        const client = new P2pRuntimeClient(channel.port1, {
            signerAddress: signer.address,
            scm,
            stateMachine,
            provider: ethers.provider
        });

        const destroySpy = sinon.spy(WebSocketProvider.prototype, "destroy");
        try {
            let startupError: unknown;
            try {
                await startP2pRuntimeHost(
                    channel.port2,
                    {
                        config: createConfig({
                            PROVIDER_URL:
                                process.env.PROVIDER_URL ??
                                "http://127.0.0.1:18545"
                        }),
                        scm,
                        stateMachine,
                        signerSecret: signer.privateKey
                    },
                    {
                        threadLabel: "startup-failure-test"
                    }
                );
            } catch (error) {
                startupError = error;
            }
            let clientError: unknown;
            try {
                await client.ready;
            } catch (error) {
                clientError = error;
            }

            expect(startupError).to.be.instanceOf(Error);
            expect((startupError as Error).message).to.not.include("timed out");
            expect(destroySpy.calledOnce).to.equal(true);
            expect(clientError).to.be.instanceOf(Error);
            expect((clientError as Error).message).to.equal(
                (startupError as Error).message
            );
            expect((clientError as Error).message).to.not.include("timed out");
        } finally {
            destroySpy.restore();
        }
    });
});
