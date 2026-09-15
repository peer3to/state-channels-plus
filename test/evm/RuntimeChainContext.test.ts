import { resolveWebSocketProviderUrl } from "@/evm/p2pRuntime/RuntimeChainContext";
import {
    assertHostOwnedRuntimeWait,
    assertSubscriptionCleanup,
    assertRuntimeStartupFailure
} from "@test/fixtures/node/RuntimeChainContextFixture";
import { expect } from "chai";

describe("RuntimeChainContext", () => {
    it("destroys its provider without subscriptions and permits repeated cleanup", async () => {
        await assertSubscriptionCleanup(false);
    });
    it("destroys its provider with a block subscription and permits repeated cleanup", async () => {
        await assertSubscriptionCleanup(true);
    });
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
        await assertRuntimeStartupFailure();
    });

    it("lets the host own the quiesce timeout", async () => {
        await assertHostOwnedRuntimeWait("quiesce");
    });

    it("lets an uncancellable P2P signer mutation outlive the request timeout", async () => {
        await assertHostOwnedRuntimeWait("leaveLobby");
    });
});
