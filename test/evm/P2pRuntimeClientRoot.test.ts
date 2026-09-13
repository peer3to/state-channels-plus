import { childDisposedError } from "@/rpc/internal/RemoteRoot";
import {
    assertApplicationCleanupOnHostClose,
    assertCallerLoggerAfterSetupFailure
} from "@test/fixtures/node/ClientRootInitializationFixture";
import {
    withRuntimeRpc,
    assertRpcOutOfOrder,
    assertRpcPostFailure,
    assertInlineCleanupAfterDomainFailure,
    assertHostRpcDeliveryForwarding
} from "@test/fixtures/RpcRouterFixture";
import { assertRejectedCustomRootReadiness } from "@test/fixtures/RuntimeTransportModesFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("P2pRuntimeClientRoot", () => {
    it("releases application listeners and its owned logger after unexpected host closure", async () => {
        await assertApplicationCleanupOnHostClose(false);
    });
    it("releases application listeners but preserves a supplied logger after unexpected host closure", async () => {
        await assertApplicationCleanupOnHostClose(true);
    });
    it("preserves the caller logger after application setup fails", async () => {
        await assertCallerLoggerAfterSetupFailure();
    });
    it("rejects readiness with the original startup host error", async () => {
        await assertRejectedCustomRootReadiness(true);
    });
    it("forwards host RPC timeout options and sendOne addresses unchanged", async () => {
        await assertHostRpcDeliveryForwarding();
    });
    it("cleans owned inline executor endpoints after domain disposal fails", async () => {
        await assertInlineCleanupAfterDomainFailure();
    });
    it("leaves the disposal deadline with the host", async () => {
        await withRuntimeRpc(async (sdk) => {
            await sdk.instance.dispose();
            const disposal = sdk.control.events.find(
                (event) =>
                    event.direction === "send" && event.method === "dispose"
            );
            expect(disposal !== undefined).to.equal(true);
            expect(disposal!.timed).to.equal(false);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("rejects an unknown host RPC delivery and serves the next invocation", async () => {
        await withRuntimeRpc(async (sdk) => {
            const failure = await sdk.remote.hostRpc
                .invoke("query", "getForkId", [], "missingDelivery", [])
                .request()
                .catch((error: Error) => error);
            expect(failure).to.be.instanceOf(Error);
            expect((failure as Error).message).to.equal(
                "Unknown network RPC delivery 'missingDelivery'"
            );
            expect(
                await sdk.instance.hostRpc.query.getForkId().request()
            ).to.equal(ethers.ZeroHash);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("keeps a timeout-free operation pending until domain cancellation", async () => {
        await withRuntimeRpc(async (sdk) => {
            const channelId = ethers.id("runtime-client-domain-cancellation");
            const pending = sdk.instance.p2pSigner.connectToChannel(channelId, {
                autoOpen: true,
                timeoutMs: null
            });
            try {
                await waitFor(
                    async () =>
                        (
                            await sdk.instance.hostRpc.query
                                .getLobbyAvailability()
                                .request()
                        ).matching
                );
                const invocation = sdk.control.events.find(
                    (event) =>
                        event.direction === "send" &&
                        event.method === "connectToChannel"
                );
                expect(invocation !== undefined).to.equal(true);
                expect(invocation!.timed).to.equal(false);
                expect(
                    await sdk.instance.p2pSigner.cancelConnectToChannel(
                        channelId
                    )
                ).to.equal(true);
                expect(await pending).to.equal(false);
                expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            } finally {
                await sdk.instance.p2pSigner.cancelConnectToChannel(channelId);
                await pending;
            }
        });
    });
    it("uses the ordinary thirty second request default", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(
                Reflect.get(sdk.clientRoot.router, "defaultRequestTimeoutMs")
            ).to.equal(30_000);
            const held = sdk.remote.runtimeProbe
                .hold("default timeout", "released")
                .request();
            await waitFor(async () =>
                (
                    await sdk.remote.runtimeProbe.state().request()
                ).entered.includes("default timeout")
            );
            expect(sdk.control.pendingTimers()).to.equal(1);
            await sdk.remote.runtimeProbe.release("default timeout").request();
            expect(await held).to.equal("released");
            expect(sdk.control.pendingTimers()).to.equal(0);
        });
    });
    it("uses an explicit short timeout and ignores the later reply", async () => {
        await withRuntimeRpc(async (sdk) => {
            const received = sdk.control.holdNextResponse("echo");
            const result = sdk.remote.runtimeProbe
                .echo("late")
                .request({ timeoutMs: 200 })
                .catch((error: Error) => error.message);
            await received;
            expect(await result).to.equal(
                "RPC request 'runtimeProbe.echo' timed out after 200ms"
            );
            sdk.control.release();
            expect(await sdk.remote.runtimeProbe.sum(2, 4).request()).to.equal(
                6
            );
            expect(sdk.control.pendingTimers()).to.equal(0);
        });
    });
    it("keeps concurrent request results correlated", async () => {
        await assertRpcOutOfOrder();
    });
    it("cleans up a synchronous post failure and serves another call", async () => {
        await assertRpcPostFailure(true);
    });
    it("reports a post-ready host error and keeps later calls alive", async () => {
        await withRuntimeRpc(async (sdk) => {
            const reports: Error[] = [];
            const remove = sdk.instance.onHostError((error) =>
                reports.push(error)
            );
            try {
                await sdk.remote.runtimeProbe
                    .postFrame({
                        service: "errors",
                        method: "report",
                        params: [
                            { name: "Error", message: "detached host failure" }
                        ]
                    })
                    .request();
                await waitFor(() => reports.length === 1);
                expect(reports[0].message).to.equal("detached host failure");
                expect(
                    await sdk.remote.runtimeProbe.sum(8, 3).request()
                ).to.equal(11);
                expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
            } finally {
                remove();
            }
        });
    });
    it("receives ready before the deployComplete response", async () => {
        await withRuntimeRpc(async (sdk) => {
            const events = sdk.control.events;
            const deployment = events.find(
                (event) =>
                    event.direction === "send" &&
                    event.method === "deployComplete"
            );
            expect(deployment).not.to.equal(undefined);
            const readyIndex = events.findIndex(
                (event) =>
                    event.direction === "receive" && event.method === "ready"
            );
            const responseIndex = events.findIndex(
                (event) =>
                    event.direction === "receive" &&
                    event.response &&
                    event.requestId === deployment!.requestId
            );
            expect(readyIndex).to.be.greaterThan(-1);
            expect(responseIndex).to.be.greaterThan(readyIndex);
        });
    });
    it("receives the dispose response before closing its connection", async () => {
        await withRuntimeRpc(async (sdk) => {
            await sdk.instance.dispose();
            const events = sdk.control.events;
            const disposal = events.find(
                (event) =>
                    event.direction === "send" && event.method === "dispose"
            );
            expect(disposal).not.to.equal(undefined);
            const responseIndex = events.findIndex(
                (event) =>
                    event.direction === "receive" &&
                    event.response &&
                    event.requestId === disposal!.requestId
            );
            const closeIndex = events.findIndex(
                (event) => event.direction === "close"
            );
            expect(responseIndex).to.be.greaterThan(-1);
            expect(closeIndex).to.be.greaterThan(responseIndex);
            expect(sdk.clientRoot.connections.size).to.equal(0);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
    it("makes repeated disposal harmless and rejects later requests", async () => {
        await withRuntimeRpc(async (sdk) => {
            const disposal = sdk.instance.dispose();
            expect(sdk.instance.dispose() === disposal).to.equal(true);
            await disposal;
            expect(sdk.instance.dispose() === disposal).to.equal(true);
            const result = await sdk.remote.runtimeProbe
                .sum(1, 1)
                .request()
                .catch((error: Error) => error.message);
            expect(result).to.equal(childDisposedError().message);
            expect(
                sdk.control.events.filter(
                    (event) => event.direction === "close"
                ).length
            ).to.equal(1);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        });
    });
});
