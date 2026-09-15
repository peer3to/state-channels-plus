// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { startLogReceiver } from "./logging/LogUploader.fixture";
import {
    createLoggerSdkFixture,
    type LoggerSdkFixture
} from "./node/LoggerServiceFixture";
import {
    protocolEventTimeoutMs,
    MIN_TEST_TIME_CONFIG
} from "../harness/core/testTimeConfig";
import { waitFor } from "../utils/waitFor";
import type { RuntimeProbeRoot } from "./runtimeRpc/probe/runtime/RuntimeProbeService";
import { RuntimeRpcControl } from "./runtimeRpc/RuntimeRpcControl";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import RpcMethodsProxy from "@/rpc/network/RpcHandleProxy";
import RpcHandler from "@/rpc/network/RpcHandler";
import InternalTransport from "@/transport/InternalTransport";
import {
    createRuntimeChannel,
    createTransferableChannel
} from "@platform/p2pRuntimeChannel";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";

import { expect } from "chai";
import { ethers } from "ethers";

export async function withTwoRuntimeCallers(
    operation: (
        first: RuntimeConnection<RuntimeProbeRoot>,
        second: RuntimeConnection<RuntimeProbeRoot>,
        closeSecond: () => void,
        secondControl: RuntimeRpcControl
    ) => Promise<void>
): Promise<void> {
    await withRuntimeRpc(async (firstSdk) => {
        await withRuntimeRpc(async (secondSdk) => {
            const host = [...firstSdk.roots].find(
                (root) => root instanceof P2pRuntimeHostRoot
            );
            if (!host) throw new Error("Expected actual inline SDK host");
            const service = Reflect.get(host, "runtimeProbe");
            const channel = createRuntimeChannel();
            const receiving = host.connect<RuntimeProbeRoot>(channel.port1, {
                sameRealm: true,
                remoteRelation: "child"
            });
            const sending = secondSdk.clientRoot.connect<RuntimeProbeRoot>(
                channel.port2,
                { sameRealm: true, remoteRelation: "parent" }
            );
            const closeSecond = () => {
                sending["transport"].close(true);
                receiving["transport"].close(true);
            };
            try {
                await operation(
                    firstSdk.remote,
                    sending.rpc,
                    closeSecond,
                    RuntimeRpcControl.attachTo(sending)
                );
                expect(Reflect.get(host, "runtimeProbe") === service).to.equal(
                    true
                );
                expect(host.router.pendingRequestCount).to.equal(0);
            } finally {
                closeSecond();
            }
        });
    });
}

export async function assertInternalNetworkRejection(
    delivery: "request" | "sendOne" | "sendMultiple"
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const root = [...sdk.roots].find(
            (candidate): candidate is P2pRuntimeHostRoot =>
                candidate instanceof P2pRuntimeHostRoot
        );
        if (!root) throw new Error("Expected actual SDK host root");
        const manager = root.hostRpc.requireManager();
        const handler = new RpcHandler(
            { service: "query", method: "getForkId", params: [] },
            manager
        );
        if (delivery === "request") {
            const result = await Reflect.apply(handler.request, handler, [
                sdk.parentTransport
            ]).catch((error: Error) => error.message);
            expect(result).to.equal(
                "Internal transport is not a network recipient"
            );
        } else {
            expect(() =>
                Reflect.apply(handler[delivery], handler, [
                    delivery === "sendMultiple"
                        ? [sdk.parentTransport]
                        : sdk.parentTransport
                ])
            ).to.throw("Invalid network recipient");
        }
        expect(manager.rpcRouter.pendingRequestCount).to.equal(0);
        expect(await sdk.remote.runtimeProbe.sum(1, 2).request()).to.equal(3);
    });
}

export async function assertHostRpcDeliveryForwarding(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected the actual SDK host");
        const invoke = host.hostRpc.invoke.bind(host.hostRpc);
        const calls: Array<{ delivery: string; args: unknown[] }> = [];
        host.hostRpc.invoke = (service, method, params, delivery, args) => {
            calls.push({ delivery, args });
            return invoke(service, method, params, delivery, args);
        };
        try {
            const options = { timeoutMs: 4321 };
            expect(
                await sdk.instance.hostRpc.query.getForkId().request(options)
            ).to.equal(ethers.ZeroHash);
            const address = await sdk.instance.p2pSigner.getAddress();
            // The runtime handler accepts explicit send delivery even for an untyped value endpoint.
            await Reflect.get(
                sdk.instance.hostRpc.query.getForkId(),
                "sendOne"
            )(address);
            expect(calls).to.deep.equal([
                { delivery: "request", args: [options] },
                { delivery: "sendOne", args: [address] }
            ]);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            host.hostRpc.invoke = invoke;
        }
    });
}

export async function assertTransferredPort(inline: boolean): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const channel = createTransferableChannel();
        const received = new Promise<unknown>((resolve) =>
            channel.localPort.onMessage(resolve)
        );
        channel.localPort.start();
        try {
            await sdk.remote.runtimeProbe
                .transferredPort(
                    channel.transferablePort,
                    "message crossed transferred port"
                )
                .request({ transfer: [channel.transferablePort] });
            expect(await received).to.equal("message crossed transferred port");
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            channel.localPort.close();
        }
    }, inline);
}

export async function withRuntimeRpc(
    operation: (sdk: LoggerSdkFixture) => Promise<void>,
    inline = true
): Promise<void> {
    const receiver = await startLogReceiver();
    const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: inline });
    try {
        await operation(sdk);
    } finally {
        sdk.control.release();
        await sdk.remote.runtimeProbe
            .releaseAll()
            .request()
            .catch(() => undefined);
        try {
            await sdk.dispose();
        } finally {
            await receiver.close();
        }
    }
}

export async function assertRpcResult(value: unknown): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        expect(
            await sdk.remote.runtimeProbe.echo(value).request()
        ).to.deep.equal(value);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        expect(sdk.control.pendingTimers()).to.equal(0);
    });
}

export async function assertRpcEndpointFailure(
    asyncFailure: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const request = asyncFailure
            ? sdk.remote.runtimeProbe.failAsync("endpoint failed").request()
            : sdk.remote.runtimeProbe.failSync("endpoint failed").request();
        let failure: unknown;
        try {
            await request;
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect((failure as Error).message).to.equal("endpoint failed");
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        expect(sdk.control.pendingTimers()).to.equal(0);
    });
}

export async function assertRpcOutOfOrder(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const completed: string[] = [];
        const first = sdk.remote.runtimeProbe
            .hold("first", 1)
            .request()
            .then((value) => {
                completed.push("first");
                return value;
            });
        const second = sdk.remote.runtimeProbe
            .hold("second", 2)
            .request()
            .then((value) => {
                completed.push("second");
                return value;
            });
        await waitFor(
            async () =>
                (await sdk.remote.runtimeProbe.state().request()).entered
                    .length === 2
        );
        await sdk.remote.runtimeProbe.release("second").request();
        expect(await second).to.equal(2);
        expect(completed).to.deep.equal(["second"]);
        await sdk.remote.runtimeProbe.release("first").request();
        expect(await first).to.equal(1);
        expect(completed).to.deep.equal(["second", "first"]);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
    });
}

export async function assertRpcPostFailure(
    transferFailure: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        let failure: unknown;
        try {
            await sdk.remote.runtimeProbe
                .echo(transferFailure ? "value" : () => undefined)
                .request(transferFailure ? { transfer: [{}] } : undefined);
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        expect(sdk.control.pendingTimers()).to.equal(0);
        expect(await sdk.remote.runtimeProbe.sum(1, 2).request()).to.equal(3);
    });
}

type SettlementCause = "reply" | "remote error" | "timeout" | "owner rejection";
export async function assertSettlementRace(
    first: SettlementCause,
    second: SettlementCause
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const received = sdk.control.holdNextResponse("echo");
        let settlements = 0;
        let outcome: unknown;
        const result = sdk.remote.runtimeProbe
            .echo("success")
            .request({
                timeoutMs:
                    first === "timeout"
                        ? 300
                        : protocolEventTimeoutMs(MIN_TEST_TIME_CONFIG)
            })
            .then(
                (value) => {
                    settlements++;
                    outcome = value;
                },
                (error: Error) => {
                    settlements++;
                    outcome = error.message;
                }
            );
        await received;
        const requestId = sdk.frames.find(
            (frame) => frame.method === "echo"
        )!.requestId!;
        sdk.remote.runtimeProbe
            .postFrame({
                rpcResponse: true,
                requestId,
                ok: false,
                error: "remote failure"
            })
            .send();
        await sdk.remote.runtimeProbe.state().request();
        expect(sdk.control.heldCount).to.equal(2);
        const settle = async (cause: SettlementCause) => {
            if (cause === "reply") sdk.control.releaseAt(0);
            else if (cause === "remote error")
                sdk.control.releaseAt(sdk.control.heldCount - 1);
            else if (cause === "owner rejection")
                sdk.clientRoot.router.rejectPendingRpcRequestsForTransport(
                    sdk.parentTransport,
                    new Error("owner rejected")
                );
            else
                await waitFor(
                    () => sdk.clientRoot.router.pendingRequestCount === 0,
                    protocolEventTimeoutMs(MIN_TEST_TIME_CONFIG),
                    10
                );
        };
        await settle(first);
        await result;
        if (second !== "timeout") await settle(second);
        sdk.control.release();
        expect(settlements).to.equal(1);
        const expected =
            first === "reply"
                ? "success"
                : first === "remote error"
                  ? "remote failure"
                  : first === "owner rejection"
                    ? "owner rejected"
                    : "RPC request 'runtimeProbe.echo' timed out after 300ms";
        expect(outcome).to.equal(expected);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        expect(sdk.control.pendingTimers()).to.equal(0);
        expect(await sdk.remote.runtimeProbe.sum(7, 2).request()).to.equal(9);
    });
}

export async function assertMutablePeerProxyContext(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected actual SDK host");
        const manager = host.hostRpc.requireManager();
        const root = manager.localRpc;
        const context = {
            serviceName: "beforeAliasRegistration",
            service: Reflect.get(root, "query")
        };
        const proxy = RpcMethodsProxy.createProxy(context);
        const invoke = Reflect.get(proxy, "getForkId");
        context.serviceName = "query";
        expect(await invoke().request()).to.equal(ethers.ZeroHash);
        expect(manager.rpcRouter.pendingRequestCount).to.equal(0);
    });
}

export async function assertInlineCleanupAfterDomainFailure(): Promise<void> {
    await withRuntimeRpc(async (first) => {
        await withRuntimeRpc(async (second) => {
            const host = [...first.roots].find(
                (root): root is P2pRuntimeHostRoot =>
                    root instanceof P2pRuntimeHostRoot
            );
            if (!host) throw new Error("Expected actual SDK host");
            const sm = host.hostRpc.requireManager().stateManager;
            const dispose = sm.dispose.bind(sm);
            const children = [...host.connections.values()]
                .filter((connection) => connection.remoteRelation === "child")
                .map((connection) => ({
                    transport: connection["transport"],
                    root: connection["localPeerRemoteRoot"]!["owner"]
                }));
            // Run real cleanup, then make its awaited boundary report a failure.
            sm.dispose = async () => {
                await dispose();
                throw new Error("domain cleanup failed");
            };
            try {
                const failure = await first.remote.lifecycle
                    .dispose()
                    .request({ timeoutMs: null })
                    .catch((error: Error) => error.message);
                expect(failure).to.equal("domain cleanup failed");
                for (const child of children) {
                    expect(host.connections.has(child.transport)).to.equal(
                        false
                    );
                    expect(child.root.connections.size).to.equal(0);
                    expect(RootCreationControl.roots.has(child.root)).to.equal(
                        false
                    );
                }
                await first.instance.dispose();
                await first.instance.dispose();
                expect(RootCreationControl.roots.has(host)).to.equal(false);
                expect(
                    await second.remote.runtimeProbe.sum(4, 5).request()
                ).to.equal(9);
            } finally {
                sm.dispose = dispose;
            }
        });
    });
}

export async function assertCommonLifecycleComposition(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected actual inline SDK host");
        expect(sdk.roots.size).to.equal(3);
        for (const root of sdk.roots) {
            expect(root.lifecycle.router === root.router).to.equal(true);
            for (const transport of root.connections.keys()) {
                await root.router.sendRpcRequest(
                    { service: "lifecycle", method: "ready", params: [] },
                    transport
                );
            }
        }
        // Cleanup cannot be requested upward.
        for (const connection of host.connections.values()) {
            if (connection.remoteRelation !== "child") continue;
            await connection.dispose();
        }
        expect(host.children.size).to.equal(0);
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}

export async function assertLoopbackRegistration(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected inline host");
        const manager = host.hostRpc.requireManager();
        const transport = manager.loopbackTransport;
        const send = transport.send;
        let registered = false;
        transport.send = function (...args) {
            registered = manager.rpcRouter.pendingRequestCount > 0;
            return send.apply(this, args);
        };
        try {
            await sdk.instance.hostRpc.query.getForkId().request();
            expect(registered).to.equal(true);
            expect(manager.rpcRouter.pendingRequestCount).to.equal(0);
        } finally {
            transport.send = send;
        }
    });
}

export async function assertPortSubscriptionsRemoved(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const { port1, port2 } = createRuntimeChannel();
        let messagesRemoved = 0;
        let closesRemoved = 0;
        const onMessage = port1.onMessage.bind(port1);
        const onClose = port1.onClose.bind(port1);
        port1.onMessage = (listener) => {
            const remove = onMessage(listener);
            return () => {
                messagesRemoved++;
                remove();
            };
        };
        port1.onClose = (listener) => {
            const remove = onClose(listener);
            return () => {
                closesRemoved++;
                remove();
            };
        };
        const transport = new InternalTransport(sdk.clientRoot.router, port1);
        try {
            transport.close();
            transport.close();
            expect(messagesRemoved).to.equal(1);
            expect(closesRemoved).to.equal(1);
        } finally {
            transport.close();
            port2.close();
        }
    });
}
