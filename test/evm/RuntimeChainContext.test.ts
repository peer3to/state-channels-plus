import { expect } from "chai";
import { ethers } from "hardhat";
import { type Interface, WebSocketProvider } from "ethers";
import sinon from "sinon";
import { stateChannelManagerAbi } from "@/utils/stateChannelManager";

import { resolveWebSocketProviderUrl } from "@/evm/p2pRuntime/RuntimeChainContext";
import { startP2pRuntimeHost } from "@/evm/p2pRuntime/P2pRuntimeHost";
import P2pRuntimeClient from "@/evm/p2pRuntime/P2pRuntimeClient";
import Clock from "@/Clock";
import { createConfig } from "@/utils/config";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import type {
    RuntimeClientRequest,
    RuntimeHostMessage
} from "@/evm/p2pRuntime/types";

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
            abiJson: new ethers.Interface(stateChannelManagerAbi).formatJson()
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
                            // Deliberately unreachable: this case asserts that
                            // a failed chain connection is reported and the
                            // host provider destroyed. It must NOT pick up an
                            // ambient PROVIDER_URL — the runner offers every
                            // task a live node, which would make startup
                            // succeed and the assertions below meaningless.
                            PROVIDER_URL: "http://127.0.0.1:1"
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

    it("lets the host own the quiesce timeout", async () => {
        const clock = sinon.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout"]
        });
        const channel = createRuntimeChannel();
        const signer = ethers.Wallet.createRandom();
        const consumerAbi = [
            "function consumerValue(bytes32 key) view returns (uint256)"
        ];
        const scm = {
            address: ethers.Wallet.createRandom().address,
            abiJson: new ethers.Interface(consumerAbi).formatJson()
        };
        const client = new P2pRuntimeClient(channel.port1, {
            signerAddress: signer.address,
            scm,
            stateMachine: {
                address: ethers.Wallet.createRandom().address,
                abiJson: "[]"
            },
            provider: ethers.provider
        });
        const managerInterface: Interface =
            client.stateChannelManagerContract.interface;
        expect(managerInterface.getFunction("consumerValue")).to.not.equal(
            null
        );
        expect(managerInterface.getError("ECDSAInvalidSignature")).to.not.equal(
            null
        );
        let quiesceRequestId: number | undefined;
        let resolveQuiesceReceived!: () => void;
        const quiesceReceived = new Promise<void>((resolve) => {
            resolveQuiesceReceived = resolve;
        });

        channel.port2.onMessage((raw) => {
            const request = raw as RuntimeClientRequest;
            if (request.type === "quiesce") {
                quiesceRequestId = request.requestId;
                resolveQuiesceReceived();
                return;
            }
            channel.port2.post({
                type: "response",
                requestId: request.requestId,
                ok: true,
                result: undefined
            } satisfies RuntimeHostMessage);
        });
        channel.port2.start();

        try {
            const quiesce = client.quiesce();
            await quiesceReceived;
            await clock.tickAsync(30_001);
            channel.port2.post({
                type: "response",
                requestId: quiesceRequestId!,
                ok: true,
                result: []
            } satisfies RuntimeHostMessage);

            expect(await quiesce).to.deep.equal([]);
        } finally {
            clock.restore();
            await client.dispose();
            channel.port2.close();
        }
    });

    it("lets an uncancellable P2P signer mutation outlive the request timeout", async () => {
        const clock = sinon.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout"]
        });
        const channel = createRuntimeChannel();
        const signer = ethers.Wallet.createRandom();
        const scm = {
            address: ethers.Wallet.createRandom().address,
            abiJson: new ethers.Interface(stateChannelManagerAbi).formatJson()
        };
        const client = new P2pRuntimeClient(channel.port1, {
            signerAddress: signer.address,
            scm,
            stateMachine: {
                address: ethers.Wallet.createRandom().address,
                abiJson: "[]"
            },
            provider: ethers.provider
        });
        let sendRequestId: number | undefined;
        let resolveSendReceived!: () => void;
        const sendReceived = new Promise<void>((resolve) => {
            resolveSendReceived = resolve;
        });

        channel.port2.onMessage((raw) => {
            const request = raw as RuntimeClientRequest;
            if (request.type === "sendTransaction") {
                sendRequestId = request.requestId;
                resolveSendReceived();
                return;
            }
            channel.port2.post({
                type: "response",
                requestId: request.requestId,
                ok: true,
                result: undefined
            } satisfies RuntimeHostMessage);
        });
        channel.port2.start();

        try {
            const send = client.signer.sendTransaction({ data: "0x" });
            await sendReceived;
            await clock.tickAsync(30_001);
            channel.port2.post({
                type: "response",
                requestId: sendRequestId!,
                ok: true,
                result: undefined
            } satisfies RuntimeHostMessage);

            expect(await send).to.equal(
                "There is no TransactionResponse p2p - everything executed locally"
            );
        } finally {
            clock.restore();
            await client.dispose();
            channel.port2.close();
        }
    });
});
