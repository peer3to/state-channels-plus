import {
    assertLoopbackRegistration,
    assertSettlementRace,
    assertRpcResult,
    assertRpcEndpointFailure,
    assertRpcOutOfOrder,
    assertRpcPostFailure,
    withRuntimeRpc
} from "@test/fixtures/RpcRouterFixture";
import { expect } from "chai";

describe("RpcRouter", () => {
    it("registers before synchronous loopback delivery can reply", async () => {
        await assertLoopbackRegistration();
    });
    it("resolves false without changing the result", async () => {
        await assertRpcResult(false);
    });
    it("resolves zero without changing the result", async () => {
        await assertRpcResult(0);
    });
    it("resolves null without changing the result", async () => {
        await assertRpcResult(null);
    });
    it("resolves undefined without changing the result", async () => {
        await assertRpcResult(undefined);
    });
    it("keeps concurrent out-of-order responses separate", async () => {
        await assertRpcOutOfOrder();
    });
    it("returns sync endpoint failures and serves the next call", async () => {
        await assertRpcEndpointFailure(false);
    });
    it("returns async endpoint failures and serves the next call", async () => {
        await assertRpcEndpointFailure(true);
    });
    it("rejects a synchronous post failure and releases its entry", async () => {
        await assertRpcPostFailure(true);
    });
    it("rejects an uncloneable argument without leaving pending work", async () => {
        await assertRpcPostFailure(false);
    });
    it("uses the supplied timeout and cancels it after settlement", async () => {
        await withRuntimeRpc(async (sdk) => {
            const received = sdk.control.holdNextResponse("echo");
            const result = sdk.remote.runtimeProbe
                .echo("late")
                .request({ timeoutMs: 300 })
                .catch((error: Error) => error);
            await received;
            expect(sdk.control.pendingTimers()).to.equal(1);
            expect(((await result) as Error).message).to.include(
                "timed out after 300ms"
            );
            sdk.control.release();
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            expect(sdk.control.pendingTimers()).to.equal(0);
            expect(
                await sdk.remote.runtimeProbe.echo("next").request()
            ).to.equal("next");
        });
    });
    it("keeps a timeout-free call pending until its owner settles it", async () => {
        await withRuntimeRpc(async (sdk) => {
            const received = sdk.control.holdNextResponse("echo");
            const result = sdk.remote.runtimeProbe
                .echo("held")
                .request({ timeoutMs: null });
            await received;
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(1);
            expect(sdk.control.pendingTimers()).to.equal(0);
            sdk.control.release();
            expect(await result).to.equal("held");
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("keeps reply settlement before remote error", async () => {
        await assertSettlementRace("reply", "remote error");
    });
    it("keeps reply settlement before timeout", async () => {
        await assertSettlementRace("reply", "timeout");
    });
    it("keeps reply settlement before owner rejection", async () => {
        await assertSettlementRace("reply", "owner rejection");
    });
    it("keeps remote error settlement before reply", async () => {
        await assertSettlementRace("remote error", "reply");
    });
    it("keeps remote error settlement before timeout", async () => {
        await assertSettlementRace("remote error", "timeout");
    });
    it("keeps remote error settlement before owner rejection", async () => {
        await assertSettlementRace("remote error", "owner rejection");
    });
    it("keeps timeout settlement before reply", async () => {
        await assertSettlementRace("timeout", "reply");
    });
    it("keeps timeout settlement before remote error", async () => {
        await assertSettlementRace("timeout", "remote error");
    });
    it("keeps timeout settlement before owner rejection", async () => {
        await assertSettlementRace("timeout", "owner rejection");
    });
    it("keeps owner rejection settlement before reply", async () => {
        await assertSettlementRace("owner rejection", "reply");
    });
    it("keeps owner rejection settlement before remote error", async () => {
        await assertSettlementRace("owner rejection", "remote error");
    });
    it("keeps owner rejection settlement before timeout", async () => {
        await assertSettlementRace("owner rejection", "timeout");
    });
    it("ignores unknown and duplicate responses", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(
                await sdk.remote.runtimeProbe.echo("original").request()
            ).to.equal("original");
            const requestId = sdk.frames.find(
                (frame) => frame.method === "echo"
            )!.requestId!;
            sdk.remote.runtimeProbe
                .postFrame({
                    rpcResponse: true,
                    requestId,
                    ok: true,
                    result: "duplicate"
                })
                .send();
            sdk.remote.runtimeProbe
                .postFrame({
                    rpcResponse: true,
                    requestId: "unknown",
                    ok: false,
                    error: "unknown"
                })
                .send();
            expect(
                await sdk.remote.runtimeProbe.echo("next").request()
            ).to.equal("next");
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("rejects all entries once and releases timers", async () => {
        await withRuntimeRpc(async (sdk) => {
            let rejected = 0;
            const first = sdk.remote.runtimeProbe
                .hold("one", 1)
                .request()
                .catch((error: Error) => {
                    rejected++;
                    return error.message;
                });
            const second = sdk.remote.runtimeProbe
                .hold("two", 2)
                .request()
                .catch((error: Error) => {
                    rejected++;
                    return error.message;
                });
            await sdk.remote.runtimeProbe.state().request();
            sdk.clientRoot.router.rejectAllRpcRequests(
                new Error("all rejected")
            );
            sdk.clientRoot.router.rejectAllRpcRequests(
                new Error("second rejection")
            );
            expect(await Promise.all([first, second])).to.deep.equal([
                "all rejected",
                "all rejected"
            ]);
            expect(rejected).to.equal(2);
            expect(sdk.control.pendingTimers()).to.equal(0);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            await sdk.remote.runtimeProbe.release("one").request();
            await sdk.remote.runtimeProbe.release("two").request();
        });
    });
});
