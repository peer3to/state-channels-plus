// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { startLogReceiver } from "./logging/LogUploader.fixture";
import { createLoggerSdkFixture } from "./node/LoggerServiceFixture";
import { withRuntimeRpc } from "./RpcRouterFixture";
import { RootCreationControl } from "./runtimeRpc/RootCreationControl";
import { RuntimeRpcControl } from "./runtimeRpc/RuntimeRpcControl";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import { DetachedPromises } from "@/utils/DetachedPromises";
import { createLogger } from "@/utils/logging";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import { expect } from "chai";

export async function assertLifecycleReadiness(
    order: "signal-first" | "wait-first" | "close"
) {
    await withRuntimeRpc(async (sdk) => {
        const previous = new Set(sdk.clientRoot.children);
        let held!: Promise<void>;
        let control!: RuntimeRpcControl;
        RootCreationControl.connections(sdk.clientRoot, (connection) => {
            if (
                connection.remoteRelation !== "child" ||
                previous.has(connection)
            )
                return;
            control = RuntimeRpcControl.attachTo(connection);
            held = control.holdNextMessage("ready");
        });
        const creating = createRoot(ContractExecutorRoot, {
            parent: sdk.clientRoot,
            mode: "inline",
            args: { config, customPrecompiles: [] }
        });
        void creating.catch(() => undefined);
        const child = [...sdk.clientRoot.children].find(
            (entry) => !previous.has(entry)
        )!;
        const connection = RootCreationControl.connection(
            sdk.clientRoot,
            child
        );
        try {
            await held;
            if (order === "close") {
                const ready = child
                    .awaitReady()
                    .catch((error: Error) => error.message);
                connection["transport"].close();
                expect(await ready).to.equal(
                    "Runtime child closed before ready"
                );
                await creating.catch(() => undefined);
            } else {
                let resolved = false;
                const waiting =
                    order === "wait-first"
                        ? child.awaitReady().then(() => {
                              resolved = true;
                          })
                        : undefined;
                await Promise.resolve();
                expect(resolved).to.equal(false);
                control.release();
                await creating;
                expect(child.awaitReady() === child.awaitReady()).to.equal(
                    true
                );
                await child.awaitReady();
                await waiting;
            }
            await sdk.clientRoot.lifecycle.awaitReady(sdk.parentTransport);
        } finally {
            control.release();
            await child.dispose();
        }
    });
}

export async function assertLifecycleDisposal(
    failChild: boolean,
    preparation: "normal" | "held" | "failed" = "normal"
) {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected actual SDK host");
        const child = [...host.connections.values()].find(
            (connection) => connection.remoteRelation === "child"
        );
        if (!child?.["localPeerRemoteRoot"])
            throw new Error("Expected actual inline executor");
        const order: string[] = []; // Domain disposal order observed through the original operations.
        const childRoot = child["localPeerRemoteRoot"]["owner"];
        const childDispose = childRoot.dispose.bind(childRoot);
        const logger = host.hostRpc.requireManager().stateManager.logger;
        const hostDispose = logger.dispose.bind(logger);
        const stateManager = host.hostRpc.requireManager().stateManager;
        const prepare = stateManager.stop.bind(stateManager);
        let preparationStarted = false;
        const preparationError = new Error("Host preparation failed");
        let entered!: () => void;
        let release!: () => void;
        const preparing = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        stateManager.stop = async () => {
            if (preparationStarted) return;
            preparationStarted = true;
            order.push("prepare");
            entered();
            if (preparation === "held") await held;
            await prepare();
            if (preparation === "failed") throw preparationError;
        };
        childRoot.dispose = () => {
            if (!childRoot.isDisposing) order.push("executor");
            return childDispose();
        };
        let hostCleanupStarted = false;
        logger.dispose = (...args) => {
            if (!hostCleanupStarted) order.push("host");
            hostCleanupStarted = true;
            return hostDispose(...args);
        };
        if (failChild)
            RuntimeRpcControl.attachTo(child).failNextPost("dispose");
        const stateMachine =
            host.hostRpc.requireManager().stateManager.diamondStateMachine;
        const participants =
            preparation === "held"
                ? await stateMachine.getParticipants()
                : undefined;
        const first = host.dispose();
        expect(first === host.dispose()).to.equal(true);
        if (preparation === "held") {
            try {
                await preparing;
                expect(order).to.deep.equal(["prepare"]);
                expect(child.isClosed).to.equal(false);
                expect(await stateMachine.getParticipants()).to.deep.equal(
                    participants
                );
                expect(
                    await sdk.remote.runtimeProbe.sum(4, 5).request()
                ).to.equal(9);
            } finally {
                release();
            }
        }
        const error = await first.then(
            () => undefined,
            (error: unknown) => error
        );
        expect(error !== undefined).to.equal(
            failChild || preparation === "failed"
        );
        if (preparation === "failed")
            expect(error === preparationError).to.equal(true);
        expect(order).to.deep.equal(["prepare", "executor", "host"]);
        await host.dispose().catch(() => undefined);
        expect(order).to.deep.equal(["prepare", "executor", "host"]);
    });
}

export async function assertLifecycleQuiescence() {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected actual SDK host");
        const child = [...host.connections.values()].find(
            (connection) => connection.remoteRelation === "child"
        );
        if (!child) throw new Error("Expected actual executor connection");
        const control = RuntimeRpcControl.attachTo(child);
        const held = control.holdNextResponse("quiesce");
        const failure = Promise.reject(new Error("lifecycle drain failure"));
        void failure.catch(() => undefined);
        DetachedPromises.collect(failure);
        const first = sdk.clientRoot.lifecycle.quiesce();
        expect(first === sdk.clientRoot.lifecycle.quiesce()).to.equal(true);
        let settled = false;
        void first.then(() => {
            settled = true;
        });
        try {
            await held;
            expect(settled).to.equal(false);
        } finally {
            control.release();
        }
        const result = await first;
        expect(
            result.filter(
                (error) => error.message === "lifecycle drain failure"
            )
        ).to.have.length(1);
        expect(await sdk.clientRoot.lifecycle.quiesce()).to.deep.equal([]);
        expect(
            control.sent.filter((frame) => frame.method === "quiesce")
        ).to.have.length(2);
    });
}

export async function assertLifecycleParentDirection() {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected actual SDK host");
        const parent = [...host.connections.values()].find(
            (connection) => connection.remoteRelation === "parent"
        );
        if (!parent) throw new Error("Expected actual SDK parent connection");
        for (const method of ["dispose", "quiesce"]) {
            const remote = parent.rpc as RuntimeConnection<AInternalRpcRoot>;
            const error = await (
                method === "dispose"
                    ? remote.lifecycle.dispose().request()
                    : remote.lifecycle.quiesce().request()
            ).then(
                () => "",
                (error: Error) => error.message
            );
            expect(error).to.equal(
                "Lifecycle cleanup must be requested by a parent connection"
            );
        }
        await expect(
            sdk.remote.lifecycle.disposed().request()
        ).to.be.rejectedWith("Disposal notification must come from a child");
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}

export async function assertRootDisposalTree(
    shape: "leaf" | "empty" | "siblings" | "nested"
) {
    await withRuntimeRpc(async () => {
        const root = await createRoot(ContractExecutorRoot, {
            args: { config, customPrecompiles: [] }
        });
        const closed: string[] = []; // Ordered root names observed at their public close boundary.
        root.onClosed(() => closed.push("root"));
        expect(root.parent).to.equal(null);
        expect(root.children.size).to.equal(0);
        try {
            if (shape !== "leaf") {
                const first = await createRoot(ContractExecutorRoot, {
                    parent: root,
                    mode: "inline",
                    args: { config, customPrecompiles: [] }
                });
                const firstRoot = RootCreationControl.connection(root, first)[
                    "localPeerRemoteRoot"
                ]!["owner"];
                firstRoot.onClosed(() => closed.push("first"));
                expect(firstRoot.parent !== null).to.equal(true);
                expect(root.children.has(first)).to.equal(true);
                if (shape === "empty") {
                    await first.dispose();
                    expect(root.children.size).to.equal(0);
                } else if (shape === "siblings") {
                    const second = await createRoot(ContractExecutorRoot, {
                        parent: root,
                        mode: "inline",
                        args: { config, customPrecompiles: [] }
                    });
                    RootCreationControl.connection(root, second)[
                        "localPeerRemoteRoot"
                    ]!["owner"].onClosed(() => closed.push("second"));
                    expect(root.children.size).to.equal(2);
                } else {
                    const nested = await createRoot(ContractExecutorRoot, {
                        parent: firstRoot,
                        mode: "inline",
                        args: { config, customPrecompiles: [] }
                    });
                    RootCreationControl.connection(firstRoot, nested)[
                        "localPeerRemoteRoot"
                    ]!["owner"].onClosed(() => closed.push("nested"));
                    expect(firstRoot.children.has(nested)).to.equal(true);
                }
            }
            const disposing = root.dispose();
            expect(root.dispose() === disposing).to.equal(true);
            await disposing;
            expect(() => root.executor.getExecutor()).to.throw(
                "has not been initialized"
            );
            expect(closed[closed.length - 1]).to.equal("root");
            expect(root.children.size).to.equal(0);
            expect(root.connections.size).to.equal(0);
            if (shape === "nested")
                expect(closed).to.deep.equal(["nested", "first", "root"]);
            else
                expect([...closed].sort()).to.deep.equal(
                    shape === "leaf"
                        ? ["root"]
                        : shape === "empty"
                          ? ["first", "root"]
                          : ["first", "root", "second"]
                );
            const count = closed.length;
            await root.dispose();
            expect(closed.length).to.equal(count);
        } finally {
            await root.dispose();
        }
    });
}

export async function assertSingleParent() {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        )!;
        const parent = host.parent;
        const before = host.connections.size;
        const channel = createRuntimeChannel();
        try {
            expect(() =>
                host.connect(channel.port1, {
                    sameRealm: true,
                    remoteRelation: "parent"
                })
            ).to.throw("A root can have only one parent");
            expect(host.parent === parent).to.equal(true);
            expect(host.connections.size).to.equal(before);
            expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(
                5
            );
        } finally {
            channel.port1.close();
            channel.port2.close();
        }
    });
}

export async function assertRepeatedHostQuiescence(
    inline: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        await sdk.instance.quiesce();
        await sdk.remote.runtimeProbe
            .detachFailure("second drain", true)
            .request();
        const draining = sdk.instance.quiesce();
        await sdk.remote.runtimeProbe.release("second drain").request();
        const errors = await draining;
        expect(errors.map((error) => error.message)).to.include(
            "detached second drain"
        );
        expect(await sdk.instance.quiesce()).to.deep.equal([]);
    }, inline);
}

export async function assertRootLoggerCascade(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const before = process.listenerCount("uncaughtException");
        const beforeRejection = process.listenerCount("unhandledRejection");
        const receiver = await startLogReceiver();
        const logger = createLogger(
            {},
            { component: "OwnedRootLogger" },
            {
                skipWriting: true,
                attachErrorListener: true,
                logUploaderConfig: {
                    uploadEndpoint: receiver.url,
                    jitterMaxMs: 0
                }
            }
        );
        const child = logger.child({ component: "undisposed child" });
        const leaf = child.child({ component: "undisposed grandchild" });
        const root = await createRoot(ContractExecutorRoot, {
            args: { config, customPrecompiles: [] },
            logger
        });
        try {
            expect(process.listenerCount("uncaughtException")).to.equal(
                before + 1
            );
            await root.dispose();
            await root.dispose();
            expect(() => child.info("late child")).to.throw(
                "has been disposed"
            );
            expect(() => leaf.info("late grandchild")).to.throw(
                "has been disposed"
            );
            expect(process.listenerCount("uncaughtException")).to.equal(before);
            expect(process.listenerCount("unhandledRejection")).to.equal(
                beforeRejection
            );
            const appChild = sdk.instance.logger.child({
                component: "application child"
            });
            await sdk.instance.dispose();
            expect(() => appChild.info("late application child")).to.throw(
                "has been disposed"
            );
            sdk.logger.info("supplied caller parent survives");
        } finally {
            await root.dispose();
            logger.dispose({ cascadeChildren: true });
            await receiver.close();
        }
    });
}

export async function assertWorkerDomainDisposal(
    reject: boolean
): Promise<void> {
    const receiver = await startLogReceiver();
    const sdk = await createLoggerSdkFixture(receiver, {
        inlineSdk: false,
        rejectDomainDisposal: reject
    });
    try {
        const result = await sdk.remote.runtimeProbe.disposeDomain().request();
        expect(result).to.deep.equal({
            calls: 1,
            managerWasDisposed: false,
            managerIsDisposed: true,
            connectionsAfter: 0,
            message: reject ? "root dispose boom" : ""
        });
    } finally {
        try {
            await sdk.dispose();
        } finally {
            await receiver.close();
        }
    }
}

export async function assertLostDisposalReply(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host?.parent)
            throw new Error("Expected actual SDK host and parent");
        const manager = host.hostRpc.requireManager().stateManager;
        const stop = manager.stop.bind(manager);
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        manager.stop = async () => {
            entered();
            await held;
            await stop();
        };
        const parentClosed = new Promise<void>((resolve) =>
            host.parent!.onClosed(resolve)
        );
        const close = host.lifecycle.closeAfterDispose;
        let closeCount = 0;
        let finished!: () => void;
        const closed = new Promise<void>((resolve) => {
            finished = resolve;
        });
        host.lifecycle.closeAfterDispose = async () => {
            closeCount++;
            try {
                await close?.();
            } finally {
                finished();
            }
        };
        const disposal = sdk.remote.lifecycle
            .dispose()
            .request()
            .catch((error: Error) => error);
        try {
            await started;
            sdk.parentTransport.close();
            await parentClosed;
        } finally {
            release();
        }
        expect((await disposal) instanceof Error).to.equal(true);
        await closed;
        await host.dispose();
        expect(closeCount).to.equal(1);
        expect(host.connections.size).to.equal(0);
    });
}
