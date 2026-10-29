import {
    assertInlineErrorIdentity,
    assertDetachedInlineIdentity
} from "@test/fixtures/node/RuntimeIdentityFixture";
import {
    assertTransferredPort,
    assertCommonLifecycleComposition,
    withRuntimeRpc,
    withTwoRuntimeCallers
} from "@test/fixtures/RpcRouterFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("InternalRpcRouter", () => {
    it("composes lifecycle on every SDK root and preserves inactive disposal", async () => {
        await assertCommonLifecycleComposition();
    });
    it("shares one service instance across two actual SDK caller connections", async () => {
        await withTwoRuntimeCallers(async (first, second, closeSecond) => {
            first.runtimeProbe.notify("first caller").send();
            await first.runtimeProbe.state().request();
            second.runtimeProbe.notify("second caller").send();
            expect(
                (await second.runtimeProbe.state().request()).notifications
            ).to.deep.equal(["first caller", "second caller"]);
            closeSecond();
            expect(
                (await first.runtimeProbe.state().request()).notifications
            ).to.deep.equal(["first caller", "second caller"]);
        });
    });
    it("retains each invocation sender across interleaved awaits and callbacks", async () => {
        await withTwoRuntimeCallers(async (first, second) => {
            await first.runtimeProbe
                .setCallerIdentity("first SDK caller")
                .request();
            await second.runtimeProbe
                .setCallerIdentity("second SDK caller")
                .request();
            const firstResult = first.runtimeProbe
                .callerIdentityAfterHold("first sender")
                .request();
            const secondResult = second.runtimeProbe
                .callerIdentityAfterHold("second sender")
                .request();
            await waitFor(
                async () =>
                    (await first.runtimeProbe.state().request()).entered
                        .length === 2
            );
            await first.runtimeProbe.release("second sender").request();
            expect(await secondResult).to.equal("second SDK caller");
            await second.runtimeProbe.release("first sender").request();
            expect(await firstResult).to.equal("first SDK caller");
        });
    });
    it("controls the actual executor connection through the host harness service", async () => {
        await withRuntimeRpc(async (sdk) => {
            const control = sdk.instance.hostRpc.runtimeRpc;
            await control.holdNextResponse("executor", "echo").request();
            const result = sdk.remote.runtimeProbe
                .childEcho("executor response")
                .request();
            await waitFor(
                async () =>
                    (await control.state("executor").request()).heldCount === 1
            );
            expect(
                (await control.state("executor").request()).pendingCount
            ).to.equal(1);
            expect(await sdk.remote.runtimeProbe.sum(3, 4).request()).to.equal(
                7
            );
            await control.release("executor").request();
            expect(await result).to.equal("executor response");
            expect(
                (await control.state("executor").request()).pendingCount
            ).to.equal(0);
        });
    });
    it("controls an SDK worker's executor connection through the same harness service", async () => {
        await withRuntimeRpc(async (sdk) => {
            const control = sdk.instance.hostRpc.runtimeRpc;
            await control.holdNextResponse("executor", "echo").request();
            const result = sdk.remote.runtimeProbe
                .childEcho("worker-owned executor")
                .request();
            await waitFor(
                async () =>
                    (await control.state("executor").request()).heldCount === 1
            );
            await control.release("executor").request();
            expect(await result).to.equal("worker-owned executor");
            expect(
                (await control.state("executor").request()).pendingCount
            ).to.equal(0);
        }, false);
    });
    it("returns a correlated error for a malformed recoverable request", async () => {
        await withRuntimeRpc(async (sdk) => {
            sdk.control.corruptNextParams("sum");
            expect(
                await sdk.remote.runtimeProbe
                    .sum(1, 2)
                    .request()
                    .catch((error: Error) => error.message)
            ).to.equal("Malformed RPC request");
            expect(await sdk.remote.runtimeProbe.sum(1, 2).request()).to.equal(
                3
            );
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("ignores uncorrelatable garbage and continues serving", async () => {
        await withRuntimeRpc(async (sdk) => {
            await sdk.remote.runtimeProbe.postFrame(null).request();
            await sdk.remote.runtimeProbe
                .postFrame({ requestId: 17, params: false })
                .request();
            expect(await sdk.remote.runtimeProbe.sum(2, 5).request()).to.equal(
                7
            );
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("ignores a foreign namespace frame while a request is pending", async () => {
        await withRuntimeRpc(async (sdk) => {
            const received = sdk.control.holdNextResponse("echo");
            let completed = false;
            const result = sdk.remote.runtimeProbe
                .echo("real reply")
                .request()
                .then((value) => {
                    completed = true;
                    return value;
                });
            await received;
            const requestId = sdk.frames.find(
                (frame) => frame.method === "echo"
            )!.requestId;
            await sdk.remote.runtimeProbe
                .postFrame({
                    type: "foreign-response",
                    id: requestId,
                    result: "foreign reply"
                })
                .request();
            expect(completed).to.equal(false);
            sdk.control.release();
            expect(await result).to.equal("real reply");
        });
    });
    it("transfers a MessagePort over a local SDK connection", async () => {
        await assertTransferredPort(true);
    });
    it("transfers a MessagePort into an SDK worker", async () => {
        await assertTransferredPort(false);
    });
    it("serves duplex reentrant calls over a local channel", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(
                await sdk.remote.runtimeProbe
                    .callback("returned through caller")
                    .request()
            ).to.equal("returned through caller");
        });
    });
    it("serves duplex reentrant calls through a real worker", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(
                await sdk.remote.runtimeProbe
                    .callback("worker callback")
                    .request()
            ).to.equal("worker callback");
        }, false);
    });
    it("transfers an ArrayBuffer and detaches its sender", async () => {
        await withRuntimeRpc(async (sdk) => {
            const buffer = new Uint8Array([0, 127, 255]).buffer;
            const result = sdk.remote.runtimeProbe
                .bytes(buffer)
                .request({ transfer: [buffer] });
            expect(buffer.byteLength).to.equal(0);
            expect(await result).to.deep.equal([0, 127, 255]);
        });
    });
    it("preserves binary and BigInt values by structured clone", async () => {
        await withRuntimeRpc(async (sdk) => {
            const value = {
                bytes: new Uint8Array([1, 2, 255]),
                large: 2n ** 128n
            };
            expect(
                await sdk.remote.runtimeProbe.echo(value).request()
            ).to.deep.equal(value);
        });
    });
    it("throws a send clone failure synchronously", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(() =>
                sdk.remote.runtimeProbe.notify(() => undefined).send()
            ).to.throw();
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            expect(
                (await sdk.remote.runtimeProbe.state().request()).notifications
            ).to.deep.equal([]);
        });
    });
    it("clones a mutable argument at send time", async () => {
        await withRuntimeRpc(async (sdk) => {
            const value = { amount: 3 };
            sdk.remote.runtimeProbe.notify(value).send();
            value.amount = 8;
            expect(
                (await sdk.remote.runtimeProbe.state().request()).notifications
            ).to.deep.equal([{ amount: 3 }]);
        });
    });
});

describe("InternalRpcRouter inline execution context", () => {
    it("preserves peer identity on a synchronous inline SDK endpoint failure", async () => {
        await assertInlineErrorIdentity(false, false);
    });
    it("preserves peer identity on an awaited inline SDK endpoint failure", async () => {
        await assertInlineErrorIdentity(false, true);
    });
    it("preserves peer identity on a synchronous inline executor endpoint failure", async () => {
        await assertInlineErrorIdentity(true, false);
    });
    it("preserves peer identity on an awaited inline executor endpoint failure", async () => {
        await assertInlineErrorIdentity(true, true);
    });
});

describe("InternalRpcRouter detached execution context", () => {
    it("retains detached inline SDK peer identity after another peer enters", async () => {
        await assertDetachedInlineIdentity(false);
    });
    it("retains detached inline executor peer identity after another peer enters", async () => {
        await assertDetachedInlineIdentity(true);
    });
});
