// First: it counts every WebAssembly instance this thread creates after it.
import "@/utils/threadResources";
import "./rootWorkerGlobals";
import "./threadName";
import { AInternalRpcRoot } from "./AInternalRpcRoot";
import { serializeError } from "./errorWire";
import { RemoteRoot, childDisposedError } from "./RemoteRoot";
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import type { RuntimePort } from "@/transport/RuntimePort";
import { config } from "@/utils/config";
import type { Logger, SharedLoggerContext } from "@/utils/logging/Logger";
import { LogUploader } from "@/utils/logging/LogUploader";
import { runCleanup } from "@/utils/runCleanup";
import { getThreadResources, trackWorker } from "@/utils/threadResources";
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
    /**
     * Wait, bounded, for a worker its owner stops from outside to end its own
     * cleanup (its log uploads included) before `shutdown` stops it.
     */
    drain?(): Promise<void>;
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
/**
 * A worker without an explicit parent: creation adds a hidden parent in the
 * caller's realm for this worker alone, and disposing the returned handle
 * also disposes that parent. A supplied `logger` is only borrowed: the hidden
 * parent logs through a child of it, so the caller's logger stays usable.
 */
export function createRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        mode: "worker";
        parent?: undefined;
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
    }
): Promise<RemoteRoot<TRoot>>;
/**
 * A child in either placement. `local` reaches only an inline child; it never
 * crosses a worker port, so a placement known to be a worker takes none.
 */
export function createRoot<
    TRoot extends AInternalRpcRoot,
    TArgs,
    TLocal,
    TMode extends "inline" | "worker"
>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        parent: AInternalRpcRoot;
        mode: TMode;
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: "inline" extends TMode ? TLocal : never;
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
            return createParentlessWorker(entry, {
                ...options,
                mode: "worker"
            });
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
    return createChildRoot(entry, { ...options, parent: options.parent });
}

/** Caller-side parent of one parentless worker; it has no domain service. */
class ParentlessWorkerParentRoot extends AInternalRpcRoot {
    constructor(
        _args: undefined,
        _local: undefined,
        context: RootStartContext
    ) {
        super(
            // Nothing is above this root: log what its worker reports.
            (error) =>
                this.rootLogger.error("Parentless worker reported an error", {
                    error
                }),
            30_000,
            context
        );
    }

    public async start(): Promise<void> {}

    // Implements root cleanup through the shared recursive disposal contract.
    public override dispose(): Promise<void> {
        return this.disposeRoot(() => {});
    }
}

async function createParentlessWorker<
    TRoot extends AInternalRpcRoot,
    TArgs,
    TLocal
>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        mode: "worker";
    }
): Promise<RemoteRoot<TRoot>> {
    // One hidden parent per creation; it is never shared or reused.
    const parent = await createRoot(ParentlessWorkerParentRoot, {
        args: undefined,
        // A root owns the logger it is given and disposes it with itself; the
        // caller never sees this parent, so it gets a child of the caller's
        // logger and the caller's own logger outlives the handle.
        logger: options.logger?.child({
            component: ParentlessWorkerParentRoot.name
        }),
        handlerExecutionContext: options.handlerExecutionContext
    });
    try {
        return await createChildRoot(
            entry,
            { ...options, parent },
            // The worker's connection is already closed and unregistered, so
            // the parent's own cascade cannot await this cleanup.
            () => parent.dispose()
        );
    } catch (error) {
        await parent.dispose();
        throw error;
    }
}

async function createChildRoot<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options: {
        args: TArgs;
        workerUrl?: string | URL;
        logger?: Logger;
        handlerExecutionContext?: HostHandlerExecutionContext;
        local?: TLocal;
        parent: AInternalRpcRoot;
        mode?: "inline" | "worker" | "attached";
        port?: RuntimePort;
    },
    afterCleanup?: () => Promise<void>
): Promise<RemoteRoot<TRoot>> {
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
    const creatingAtMs = Date.now();
    let worker: RootWorker | undefined;
    // When the worker was asked for, and how long `new Worker` blocked the caller.
    let spawn: { spawnedAt: number; spawnCallMs: number } | undefined;
    // A child that is not ready gets no disposal reply: draining it would wait the whole bound.
    let isChildReady = false;
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
                    // A ready child may still settle its log uploads and
                    // close itself; drain, bounded, before closing the port.
                    // A ready child that closed its port without disposing
                    // waits the whole bound and warns.
                    () => (isChildReady ? worker?.drain?.() : undefined),
                    () => childRemoteRoot.closeWithReason(childDisposedError()),
                    () => worker?.shutdown(),
                    () => afterCleanup?.()
                );
            })())
    );
    try {
        if (options.mode === "worker") {
            if (!options.workerUrl)
                throw new Error("Worker roots require an explicit workerUrl");
            // The parent's logger receives the worker's failure and drain-timeout reports.
            const spawnedAt = Date.now();
            worker = trackWorker(
                createRootWorker(
                    options.workerUrl,
                    failed,
                    parent.rootLogger,
                    entry.name
                )
            );
            spawn = { spawnedAt, spawnCallMs: Date.now() - spawnedAt };
            worker.postMessage(
                {
                    type: "connect",
                    payload: options.args,
                    config,
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
        isChildReady = true;
        // A setup that runs past its bound lists which roots became ready, and when.
        const entryFile = String(options.workerUrl ?? "")
            .split("/")
            .pop()
            ?.split("?")[0];
        parent.rootLogger.debug("Child root ready", {
            root: entry.name,
            mode: options.mode,
            readyMs: Date.now() - creatingAtMs,
            // This thread's workers and WebAssembly once the child is up.
            resources: getThreadResources(),
            // The worker's "Root worker started" names its own start (timeOrigin): the gap
            // from spawnedAt to it is the browser starting the thread.
            ...spawn,
            // A worker's own entry script is fetched in its parent's timeline.
            entryFetch: entryFile
                ? fetchedFiles().filter(({ file }) => file === entryFile)
                : []
        });
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
        close = mode === "worker" ? closeWorkerThread : () => {}
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

/**
 * Worker entries explicitly select the root to initialize. `resolveRoot`
 * picks a subclass of `entry` from the bootstrap payload instead.
 */
export function startRootWorker<TRoot extends AInternalRpcRoot, TArgs, TLocal>(
    entry: RootConstructor<TRoot, TArgs, TLocal>,
    options?: {
        threadName?: string;
        resolveRoot?: (
            payload: TArgs
        ) => Promise<RootConstructor<TRoot, TArgs, TLocal>>;
    }
): void {
    // every log line of this worker names it; unnamed it logs as "main"
    if (options?.threadName) globalThis.threadName = options.threadName;
    // A worker's clock starts at its creation: this is its bundle's download and evaluation.
    const loadedMs = globalThis.performance.now();
    onRootBootstrap<TArgs>(async (message) => {
        const bootstrapMs = globalThis.performance.now();
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
            const rootClass =
                (await options?.resolveRoot?.(message.payload)) ?? entry;
            const root = new rootClass(message.payload, undefined, context);
            const constructedMs = globalThis.performance.now();
            receivingRoot = root;
            await context.initialize(root);
            // Where a slow worker startup goes: its bundle, its parent's bootstrap, its own start,
            // and each file it fetched (from the worker's creation; 0 bytes = from cache).
            root.logger.attachedLogger.debug("Root worker started", {
                root: entry.name,
                // Epoch ms of this thread's start; its parent logs when it asked for it.
                timeOrigin: Math.round(globalThis.performance.timeOrigin),
                loadedMs: Math.round(loadedMs),
                bootstrapMs: Math.round(bootstrapMs),
                constructedMs: Math.round(constructedMs),
                startedMs: Math.round(globalThis.performance.now()),
                fetched: fetchedFiles(),
                resources: getThreadResources()
            });
        } catch (error) {
            const serialized = serializeError(error);
            // At error level this worker uploads its own log lines. Its parent
            // terminates a worker that never became ready without a drain, so
            // the upload settles, within the flush bound, before the report. A
            // root that never got a logger has none to upload.
            const logger = receivingRoot?.logger.attachedLogger;
            if (logger && !logger.isDisposed) {
                logger.error("Root worker startup failed", {
                    error,
                    wasm: serialized.wasmDiagnostics
                });
                await LogUploader.settleRealmUploads(config.CRASH_LOG_FLUSH_MS);
            }
            try {
                port.post({
                    service: "errors",
                    method: "startupFailed",
                    params: [serialized]
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
                await closeWorkerThread();
            }
        }
    });
}

/**
 * The scripts and WebAssembly this thread fetched, with their times from its
 * creation: `requestMs` is when the request was sent and `responseMs` when its
 * first byte came back (a gap from `startMs` to `requestMs` is queueing or a
 * connection, from `requestMs` to `responseMs` the server, and from there to
 * `endMs` the transfer; 0 when the server sends no timing header for another
 * origin). `protocol` is the connection's (`h2`, `http/1.1`); `kB` 0 means a
 * cache hit, or another origin that sends no timing header (`protocol` is
 * then empty).
 */
function fetchedFiles(): {
    file: string;
    startMs: number;
    requestMs: number;
    responseMs: number;
    endMs: number;
    kB: number;
    protocol: string;
}[] {
    const entries = (globalThis.performance?.getEntriesByType?.("resource") ??
        []) as PerformanceResourceTiming[];
    return entries
        .filter((entry) => /\.(m?js|wasm)(\?|$)/.test(entry.name))
        .map((entry) => ({
            file: entry.name.split("/").pop()?.split("?")[0] ?? entry.name,
            startMs: Math.round(entry.startTime),
            requestMs: Math.round(entry.requestStart),
            responseMs: Math.round(entry.responseStart),
            endMs: Math.round(entry.responseEnd),
            kB: Math.round(entry.transferSize / 1024),
            protocol: entry.nextHopProtocol
        }));
}

/**
 * The worker thread ends: it lets its uploads still running finish within the flush bound,
 * cancels the rest, then closes its handles.
 */
async function closeWorkerThread(): Promise<void> {
    await LogUploader.settleRealmUploads(config.CRASH_LOG_FLUSH_MS);
    LogUploader.cancelRealmUploads();
    await closeRootWorker();
}
