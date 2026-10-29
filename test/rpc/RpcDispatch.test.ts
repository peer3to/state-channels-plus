import {
    assertMissingEndpoint,
    assertAwaitedRouterDispatch
} from "@test/fixtures/RpcDispatchFixture";
import {
    withRuntimeRpc,
    assertRpcEndpointFailure
} from "@test/fixtures/RpcRouterFixture";
import { expect } from "chai";

describe("RpcDispatch", () => {
    it("invokes an own endpoint", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(await sdk.remote.runtimeProbe.own().request()).to.equal(
                "own"
            );
        });
    });
    it("invokes an inherited endpoint", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(
                await sdk.remote.runtimeProbe.inherited().request()
            ).to.equal("inherited");
        });
    });
    it("rejects a getter shadow without executing it", async () => {
        await assertMissingEndpoint("runtimeProbe", "shadowed", "accessor");
    });
    it("rejects a non-function shadow", async () => {
        await assertMissingEndpoint("runtimeProbe", "shadowed", "nonFunction");
    });
    it("rejects a missing service", async () => {
        await assertMissingEndpoint("missing", "echo");
    });
    it("rejects a missing method", async () => {
        await assertMissingEndpoint("runtimeProbe", "missing");
    });
    it("rejects a constructor", async () => {
        await assertMissingEndpoint("runtimeProbe", "constructor");
    });
    it("rejects an Object base method", async () => {
        await assertMissingEndpoint("runtimeProbe", "toString");
    });
    it("rejects service helpers", async () => {
        await assertMissingEndpoint("runtimeProbe", "createRPCMethods");
    });
    it("invokes the captured callable", async () => {
        await withRuntimeRpc(async (sdk) => {
            await sdk.remote.runtimeProbe.configure("capture").request();
            expect(await sdk.remote.runtimeProbe.captured().request()).to.equal(
                "original"
            );
        });
    });
    it("preserves positional and optional arguments", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(await sdk.remote.runtimeProbe.sum(4, 7).request()).to.equal(
                11
            );
            expect(await sdk.remote.runtimeProbe.sum(4).request()).to.equal(4);
        });
    });
    it("supports empty arguments and undefined results", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(await sdk.remote.runtimeProbe.echo().request()).to.equal(
                undefined
            );
        });
    });
    it("returns sync endpoint errors", async () => {
        await assertRpcEndpointFailure(false);
    });
    it("returns async endpoint errors", async () => {
        await assertRpcEndpointFailure(true);
    });
    it("acknowledges void only after the endpoint completes", async () => {
        await withRuntimeRpc(async (sdk) => {
            let settled = false;
            const request = sdk.remote.runtimeProbe
                .voidHold("void")
                .request()
                .then(() => {
                    settled = true;
                });
            expect(
                (await sdk.remote.runtimeProbe.state().request()).entered
            ).to.deep.equal(["void"]);
            expect(settled).to.equal(false);
            await sdk.remote.runtimeProbe.release("void").request();
            await request;
            expect(settled).to.equal(true);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("sends without a response or pending entry", async () => {
        await withRuntimeRpc(async (sdk) => {
            sdk.remote.runtimeProbe.notify("event").send();
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            expect(
                (await sdk.remote.runtimeProbe.state().request()).notifications
            ).to.deep.equal(["event"]);
            expect(
                sdk.frames.find((frame) => frame.method === "notify")?.requestId
            ).to.equal(undefined);
        });
    });
    it("awaits request dispatch while another RPC releases the endpoint", async () => {
        await assertAwaitedRouterDispatch(true);
    });
    it("awaits send dispatch without blocking another incoming RPC", async () => {
        await assertAwaitedRouterDispatch(false);
    });
});
