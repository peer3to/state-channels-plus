import "./rootWorkerGlobals";
import "./threadName";
import { AInternalRpcRoot } from "./AInternalRpcRoot";
import { serializeError } from "./errorWire";
import { RemoteRoot, childDisposedError } from "./RemoteRoot";
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { Logger, SharedLoggerContext } from "@/utils/logging/Logger";
import { runCleanup } from "@/utils/runCleanup";
import { createTransferableChannel } from "@platform/p2pRuntimeChannel";
import {
    onUnhandledWorkerError,
    onRootBootstrap,
    closeRootWorker,
    adaptTransferredPort,
    createRootWorker
} from "@platform/rootWorkerRuntime";

export type { RemoteRoot } from "./RemoteRoot";

export interface RootWorker {
    postMessage(value: unknown, transfer?: unknown[]): void;
    /** Mark owner-initiated closure before the worker can observe its closed port. */
    expectShutdown(): void;
    shutdown: () => Promise<void>;
    /** Worker exit supplies the failure cause before connection settlement. */
    readonly ownsConnectionClose?: boolean;
}

/** Constructor dependencies; connection wiring stays in common creation. */
export interface RootStartContext {
    readonly mode: "inline" | "worker";
    readonly logger?: Logger;
    readonly loggerContext?: SharedLoggerContext;
    readonly handlerExecutionContext?: HostHandlerExecutionContext;
}

export type RootConstructor<TRoot extends AInternalRpcRoot, TArgs, TLocal> = {
    new (
        args: TArgs,
        local: TLocal | undefined,
        context: RootStartContext
    ): TRoot;
    readonly name: string;
};

/** Creates a local top-level root, or a connected child with an explicit parent. */
export function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        args: TArgs;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: TLocal;
        parentPort: RuntimePort;
    }
): Promise<TRoot>;
export function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        parent: AInternalRpcRoot;
        mode: "attached";
        port: RuntimePort;
        args: TArgs;
    }
): Promise<RemoteRoot<TRoot>>;
export function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        args: TArgs;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: TLocal;
        parent?: never;
        mode?: "inline";
    }
): Promise<TRoot>;
export function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        parent: AInternalRpcRoot;
        mode: "inline" | "worker";
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: TLocal;
    }
): Promise<RemoteRoot<TRoot>>;
export async function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: TLocal;
        parent?: AInternalRpcRoot;
        mode?: "inline" | "worker" | "attached";
        port?: RuntimePort;
        parentPort?: RuntimePort;
    }
): Promise<TRoot | RemoteRoot<TRoot>> {
    if (!options.parent) {
        if (options.mode === "worker")
            throw new Error("Worker roots require a parent");
        let root: AInternalRpcRoot | undefined;
        try {
            const context = rootStartContext(options.parentPort, "inline", {
                logger: options.logger,
                handlerExecutionContext: options.handlerExecutionContext,
                sameRealm: !options.parentPort
            });
            const initialized = new entry(options.args, options.local, context);
            root = initialized;
            await context.initialize(initialized);
            return initialized;
        } catch (error) {
            try {
                options.parentPort?.post({
                    service: "errors",
                    method: "startupFailed",
                    params: [serializeError(error)]
                });
            } catch {
                /* Keep the startup error if its parent is already gone. */
            }
            try {
                await root?.dispose();
            } finally {
                root?.closeConnections();
                throw error;
            }
        }
    }
    const parent = options.parent;
    if (parent.isDisposing)
        throw new Error("Cannot create a child of a disposing root");
    if (!options.mode) throw new Error("Child roots require a placement mode");
    if (options.mode === "attached") {
        if (!options.port) throw new Error("Attached roots require a port");
        const remoteRoot = parent.connect<TRoot>(options.port, {
            sameRealm: false,
            remoteRelation: "child"
        });
        remoteRoot.setAfterDispose(() =>
            remoteRoot.closeWithReason(childDisposedError())
        );
        await remoteRoot.awaitReady();
        return remoteRoot;
    }
    const { localPort, transferablePort } = createTransferableChannel();
    let worker: RootWorker | undefined;
    let localRoot: AInternalRpcRoot | undefined;
    let starting: Promise<void> | undefined;
    let finishing: Promise<void> | undefined;
    const parentPort: RuntimePort = {
        ...localPort,
        close: () => {
            worker?.expectShutdown();
            localPort.close();
        },
        onClose: (handler) =>
            localPort.onClose(() => {
                if (!worker?.ownsConnectionClose) handler();
            })
    };
    const childRemoteRoot = parent.connect<TRoot>(parentPort, {
        sameRealm: options.mode === "inline",
        remoteRelation: "child"
    });
    const failed = (error: unknown) => {
        const failure =
            error instanceof Error ? error : new Error(String(error));
        childRemoteRoot.fail(failure);
    };
    childRemoteRoot.setAfterDispose(
        (confirmed = false) =>
            (finishing ??= (async () => {
                await runCleanup(
                    async () => {
                        await starting;
                        try {
                            await runCleanup(
                                () => localRoot?.dispose(),
                                // Parent-requested domain disposal settles before its final reply handshake.
                                () => localRoot?.lifecycle.completeDisposal()
                            );
                        } catch (error) {
                            // The original inline caller owns a confirmed disposal failure.
                            if (!confirmed) throw error;
                        }
                    },
                    // Final closure has settled, so both inline endpoints can close.
                    () => localRoot?.closeConnections(),
                    () => childRemoteRoot.closeWithReason(childDisposedError()),
                    () => worker?.shutdown()
                );
            })())
    );
    try {
        if (options.mode === "worker") {
            if (!options.workerUrl)
                throw new Error("Worker roots require an explicit workerUrl");
            worker = createRootWorker(options.workerUrl, failed, entry.name);
            worker.postMessage(
                {
                    type: "connect",
                    payload: options.args,
                    port: transferablePort
                } satisfies WorkerBootstrapMessage<TArgs>,
                [transferablePort]
            );
        } else {
            const args = structuredClone(options.args);
            const context = {
                ...rootStartContext(
                    adaptTransferredPort(transferablePort),
                    "inline",
                    {
                        attached: (_root, remoteRoot) =>
                            childRemoteRoot.linkLocalEndpoint(remoteRoot),
                        handlerExecutionContext: parent.handlerExecutionContext,
                        logger: options.logger
                    }
                ),
                loggerContext: parent.rootLogger.getSharedContext()
            };
            // Match worker startup: callers install their receivers before the child runs.
            starting = Promise.resolve()
                .then(async () => {
                    const root = new entry(args, options.local, context);
                    localRoot = root;
                    await context.initialize(root);
                })
                .catch(failed);
        }
        await childRemoteRoot.awaitReady();
    } catch (error) {
        childRemoteRoot.closeWithReason(
            error instanceof Error ? error : new Error(String(error))
        );
        adaptTransferredPort(transferablePort).close();
        try {
            await starting;
            if (localRoot) {
                // The transferred port was already closed above; synchronize its local
                // transport before cleanup can attempt a disposal acknowledgement.
                localRoot.parent?.closeWithReason(
                    error instanceof Error ? error : new Error(String(error))
                );
                await localRoot.dispose();
            }
            await worker?.shutdown();
        } finally {
            localRoot?.closeConnections();
            throw error;
        }
    }
    return childRemoteRoot;
}

export function rootStartContext(
    port: RuntimePort | undefined,
    mode: "inline" | "worker",
    {
        logger,
        handlerExecutionContext,
        attached,
        sameRealm = mode === "inline",
        close = mode === "worker" ? closeRootWorker : () => {}
    }: {
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        attached?: (
            root: AInternalRpcRoot,
            remoteRoot: RemoteRoot<AInternalRpcRoot>
        ) => void;
        sameRealm?: boolean;
        close?: () => void | Promise<void>;
    } = {}
) {
    return {
        mode,
        handlerExecutionContext,
        logger,
        async initialize(root: AInternalRpcRoot): Promise<void> {
            let started = false;
            const remoteRoot = port
                ? root.connect(port, { sameRealm, remoteRelation: "parent" })
                : undefined;
            if (remoteRoot) {
                attached?.(root, remoteRoot);
                // Client went away without a clean `dispose` (thread died / port closed).
                remoteRoot.onClosed(() => {
                    if (!started || root.isDisposing) return;
                    void root.dispose().catch((error) => {
                        root.logger.attachedLogger.error(
                            "Runtime dispose on parent close failed",
                            { error }
                        );
                    });
                });
                root.lifecycle.closeAfterDispose = async () => {
                    root.closeConnections();
                    await close();
                };
            }
            await root.startRuntime(this);
            if (remoteRoot?.isClosed)
                throw new Error("Root parent closed during startup");
            started = true;
            await root.lifecycle.signalReady();
        }
    };
}

/** Worker entries explicitly select the root to initialize. */
export function startRootWorker<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>
): void {
    onRootBootstrap<TArgs>(async (message) => {
        const port = adaptTransferredPort(message.port);
        let receivingRoot: AInternalRpcRoot | undefined;
        // Same policy as the sdk worker: an error outside a request is reported to
        // the host and the worker keeps serving. The funnel is registered as soon as
        // the port and the host reporter exist, before request handling begins.
        onUnhandledWorkerError((error) => {
            if (receivingRoot) receivingRoot.reportError(error);
            else
                port.post({
                    service: "errors",
                    method: "report",
                    params: [serializeError(error)]
                });
        });
        try {
            const context = rootStartContext(port, "worker");
            const root = new entry(message.payload, undefined, context);
            receivingRoot = root;
            await context.initialize(root);
        } catch (error) {
            try {
                port.post({
                    service: "errors",
                    method: "startupFailed",
                    params: [serializeError(error)]
                });
            } catch {
                /* Keep the startup error if its parent is already gone. */
            }
            try {
                await receivingRoot?.dispose();
            } catch (cleanupError) {
                receivingRoot?.logger.attachedLogger.error(
                    "Root startup cleanup failed",
                    { cleanupError }
                );
            } finally {
                receivingRoot?.closeConnections();
                port.close();
                await closeRootWorker();
            }
        }
    });
}
