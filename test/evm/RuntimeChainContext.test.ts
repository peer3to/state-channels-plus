import {
    resolveProviderUrls,
    resolveWebSocketProviderUrl
} from "@/evm/p2pRuntime/RuntimeChainContext";
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

    it("uses PROVIDER_URL alone when PROVIDER_URLS is unset", () => {
        expect(
            resolveProviderUrls({ PROVIDER_URL: "http://localhost:8545" })
        ).to.deep.equal(["ws://localhost:8545"]);
    });

    it("uses PROVIDER_URL alone when PROVIDER_URLS is empty", () => {
        expect(
            resolveProviderUrls({
                PROVIDER_URL: "https://rpc.example/http",
                PROVIDER_URLS: []
            })
        ).to.deep.equal(["wss://rpc.example/http"]);
    });

    it("lists PROVIDER_URLS in priority order in place of PROVIDER_URL", () => {
        expect(
            resolveProviderUrls({
                PROVIDER_URL: "ws://unused.example",
                PROVIDER_URLS: [
                    "https://primary.example/rpc",
                    "ws://backup.example:8546"
                ]
            })
        ).to.deep.equal([
            "wss://primary.example/rpc",
            "ws://backup.example:8546"
        ]);
    });

    it("rejects a PROVIDER_URLS entry that is not WebSocket-compatible", () => {
        expect(() =>
            resolveProviderUrls({
                PROVIDER_URL: "ws://localhost:8545",
                PROVIDER_URLS: ["ws://localhost:8545", "ipc:///tmp/node.ipc"]
            })
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
