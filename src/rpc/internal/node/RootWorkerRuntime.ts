import "../threadName";
import type { RootWorker, UncaughtFailureKind } from "../createRoot";
import { startCpuProfilerIfEnabled } from "@/evm/node/workerCpuProfiler";
import { resolveWorkerResourceLimits } from "@/evm/node/workerResourceLimits";
import { createWorkerShutdown } from "@/evm/node/workerShutdown";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import type { RuntimePort } from "@/transport/RuntimePort";
import { createConfig } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import { resolveRuntimeModulePath } from "@/utils/moduleLoader/node/resolveRuntimeModulePath";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort, Worker, type MessagePort } from "node:worker_threads";

/**
 * How long a disposed worker's loop may take to drain after closeRootWorker
 * released every handle it can close. A healthy drain only runs the pending
 * close callbacks and ends within a few loop turns; native udx/hyperswarm
 * socket closes included it stays far below one second. Five seconds leaves
 * that margin many times over under parallel-test load and still bounds a
 * teardown that a handle Node cannot list (or a leaked timer) keeps alive.
 */
export const ROOT_WORKER_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Exit code of a worker that ended itself after the drain bound. Distinct from
 * Node's own codes (1-14, 128+signal) and from codes the SDK uses elsewhere.
 */
export const ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE = 86;

/** Bootstrap-port message that carries the drain diagnostics to the parent. */
const DRAIN_TIMEOUT_MESSAGE = "rootWorkerDrainTimeout";

/** Cap on each diagnostics list so the final message stays small. */
const MAX_DRAIN_DIAGNOSTIC_ENTRIES = 50;

/** What still held a worker's loop when it ended itself after the drain bound. */
export interface RootWorkerDrainDiagnostics {
    /** Active, referenced libuv handles from the worker's diagnostic report. */
    handles: { type: string; fd?: number; address?: string }[];
    /** The worker's `process.getActiveResourcesInfo()`. */
    resources: string[];
}

/** Resolve a package root module for compiled Node or the source test runner. */
export function rootWorkerUrl(file: string): string {
    return resolveRuntimeModulePath(path.join(__dirname, "../roots", file));
}

export function createRootWorker(
    url: string | URL,
    onError: (error: Error) => void,
    logger: Logger,
    threadName?: string
): RootWorker & { shutdown(): Promise<void> } {
    // A caller may name the source entry while the compiled tree runs (or
    // the reverse); the twin that exists is the one to start.
    const workerPath = resolveRuntimeModulePath(
        url instanceof URL ? fileURLToPath(url) : url
    );
    // Transpile-only (swc via tsconfig's ts-node.swc): each worker re-loads the
    // import graph, and full ts-node type-checks it (seconds + a retained TS
    // program per worker). Types are already checked by `yarn tsc`.
    // An explicit execArgv replaces the inherited one, so keep the parent's
    // CPU-profiler flags: a `node --cpu-prof` run then profiles every root
    // thread, not only the main thread.
    // The preloads resolve from this package, not the caller's working
    // directory, so a consumer's own source entries start without it
    // installing the SDK's loaders.
    const execArgv = workerPath.endsWith(".ts")
        ? [
              ...process.execArgv.filter((flag) =>
                  flag.startsWith("--cpu-prof")
              ),
              "-r",
              require.resolve("ts-node/register/transpile-only"),
              "-r",
              require.resolve("tsconfig-paths/register")
          ]
        : undefined;
    const worker = new Worker(workerPath, {
        execArgv,
        name: threadName,
        resourceLimits: resolveWorkerResourceLimits()
    });
    const shutdownWorker = createWorkerShutdown(worker);
    let shuttingDown = false;
    let connected = false;
    const expectShutdown = () => {
        shuttingDown = true;
    };
    worker.on("error", onError);
    // Node delivers every message the worker posted before it emits `exit`,
    // so the diagnostics are here when the exit below is classified.
    let drainDiagnostics: RootWorkerDrainDiagnostics | undefined;
    worker.on("message", (message) => {
        if (message?.type === DRAIN_TIMEOUT_MESSAGE)
            drainDiagnostics = message.diagnostics;
    });
    worker.on("exit", (code: number) => {
        // Any exit the owner did not ask for is fatal, code 0 included: a
        // worker that ends on its own cannot serve the pending requests.
        if (!shuttingDown)
            return onError(new Error(`Root worker exited with ${code}`));
        // The disposed worker ended itself because its loop did not drain in
        // time: shutdown completes, and the warning names what held the loop.
        if (code === ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE)
            logger.warn(
                "Root worker did not drain its loop and exited itself",
                {
                    worker: threadName,
                    drainTimeoutMs: ROOT_WORKER_DRAIN_TIMEOUT_MS,
                    diagnostics: drainDiagnostics
                }
            );
    });
    return {
        ownsConnectionClose: true,
        expectShutdown,
        postMessage: (value, transfer) => {
            worker.postMessage(value, transfer as readonly MessagePort[]);
            connected = true;
        },
        shutdown: async () => {
            expectShutdown();
            // A failed transfer leaves the worker waiting for its first port.
            if (!connected && worker.threadId !== -1)
                worker.postMessage({ type: "close" });
            await shutdownWorker();
        }
    };
}

export function isRootWorker(): boolean {
    return parentPort !== null;
}

export function onRootBootstrap<T>(
    handler: (message: WorkerBootstrapMessage<T>) => void | Promise<void>
): void {
    if (!parentPort)
        throw new Error("Root bootstrap requires a worker parent port");
    parentPort.once("message", (message) => {
        if (message?.type === "close") {
            void closeRootWorker();
            return;
        }
        globalThis.threadName = message.threadName ?? globalThis.threadName;
        // Every root in this worker logs, stores, and uploads with its
        // creator's config, also a root that never restores one itself.
        if (message.config) createConfig(message.config);
        startCpuProfilerIfEnabled(globalThis.threadName);
        void handler(message);
    });
}

/**
 * Initiate closing a lingering handle; the loop drain awaits completion. A
 * handle its owner is already closing can refuse a second close (a dgram
 * socket throws ERR_SOCKET_DGRAM_NOT_RUNNING while its close is pending and
 * Node still lists it). Its own close completes the drain, so that refusal
 * must not stop the remaining handles from closing. Any other close failure
 * is rethrown; the drain deadline is armed before any close, so the throw
 * cannot skip the bound.
 */
function closeHandle(handle: any): void {
    try {
        // Sockets and streams (provider keep-alive sockets, torn-transport WS).
        if (typeof handle.destroy === "function") return void handle.destroy();
        // Timers — clearTimeout accepts a Timeout from setInterval too.
        if (typeof handle.refresh === "function") return clearTimeout(handle);
        // Servers, message ports, and other closeables.
        if (typeof handle.close === "function") return void handle.close();
        handle.unref?.();
    } catch (error) {
        // Already closing: see above.
        if (
            (error as NodeJS.ErrnoException)?.code !==
            "ERR_SOCKET_DGRAM_NOT_RUNNING"
        )
            throw error;
    }
}

/**
 * Close the worker's remaining handles after disposal so its event loop can
 * drain and the thread exits on its own (see workerShutdown.ts for why the
 * loop must never be force-stopped from outside). If the loop has not drained
 * after ROOT_WORKER_DRAIN_TIMEOUT_MS, the worker reports what still holds it
 * and ends itself with ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE.
 */
export async function closeRootWorker(): Promise<void> {
    const port = parentPort;
    if (!port) return;
    // Armed before any close, so nothing below can skip the bound. The
    // unreferenced deadline never keeps the loop alive itself. Collect in the
    // next check phase: inside a timer callback the report shows the timer
    // handle as unreferenced and would hide a leaked timer.
    setTimeout(
        () => setImmediate(() => exitAfterDrainTimeout(port)),
        ROOT_WORKER_DRAIN_TIMEOUT_MS
    ).unref();

    // The worker realm is disposed, but torn-down transports/providers can
    // leave referenced handles behind (idle keep-alive sockets, reconnect
    // timers of a cut connection, …). Any one of them stalls the drain — and
    // with it the whole teardown — so close everything still keeping the loop
    // alive except stdio and the bootstrap port itself. Iterate: a close
    // callback may schedule follow-up work that arms new handles.
    const keep = new Set<unknown>([
        process.stdout,
        process.stderr,
        process.stdin,
        port
    ]);
    for (let pass = 0; pass < 10; pass++) {
        const held = (process as any)
            ._getActiveHandles()
            .filter(
                (handle: any) =>
                    !keep.has(handle) && handle.hasRef?.() !== false
            );
        if (held.length === 0) break;
        held.forEach(closeHandle);
        await new Promise((resolve) => setImmediate(resolve));
    }
    // The port no longer holds the loop but stays open: it carries the
    // drain-timeout report below. Node closes it when the thread ends.
    port.unref();
    // Leaked JS timers are not in _getActiveHandles, and native addon handles
    // or requests are not listed by Node at all, so the passes above cannot
    // close them: the deadline armed above ends a loop they keep alive.
}

/**
 * Report what still holds the loop over the bootstrap port, then end this
 * thread only. Node delivers the message before the parent sees `exit`. The
 * exit is unconditional: if collecting the report throws, no message is
 * posted, and the throw would otherwise reach the worker's error funnel,
 * which keeps the worker alive.
 */
function exitAfterDrainTimeout(port: MessagePort): never {
    try {
        port.postMessage({
            type: DRAIN_TIMEOUT_MESSAGE,
            diagnostics: collectDrainDiagnostics()
        });
    } finally {
        process.exit(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
    }
}

function collectDrainDiagnostics(): RootWorkerDrainDiagnostics {
    // Node types the report as `object`; its libuv section is this shape.
    const report = process.report.getReport() as {
        libuv: {
            type: string;
            is_active: boolean;
            is_referenced?: boolean;
            fd?: number;
            address?: string;
        }[];
    };
    const handles = report.libuv
        // The idle handle is this collection's own setImmediate; a leaked
        // immediate still shows as "Immediate" in the resources.
        .filter(
            (handle) =>
                handle.is_active &&
                handle.is_referenced === true &&
                handle.type !== "idle"
        )
        .slice(0, MAX_DRAIN_DIAGNOSTIC_ENTRIES)
        .map(({ type, fd, address }) => ({ type, fd, address }));
    return {
        handles,
        resources: process
            .getActiveResourcesInfo()
            .slice(0, MAX_DRAIN_DIAGNOSTIC_ENTRIES)
    };
}

/** Adapt the transferred raw port to the platform-neutral surface. */
export function adaptTransferredPort(port: unknown): RuntimePort {
    return adaptPort(port as MessagePort);
}

/**
 * Forward this worker thread's unhandled errors/rejections to `handler`.
 * Registering a handler also keeps an uncaught exception from terminating the
 * worker before it can be funnelled to the orchestrator.
 */
export function onUnhandledWorkerError(
    handler: (failure: unknown, kind: UncaughtFailureKind) => void
): void {
    process.on("unhandledRejection", (reason) =>
        handler(reason, "unhandled rejection")
    );
    process.on("uncaughtException", (error) =>
        handler(error, "uncaught exception")
    );
}

export function reportRootStartupTiming(timing: {
    runtimeReadyMs: number;
    runtimeThread?: string;
}): void {
    process.stdout.write(`##E2E_TIMING## ${JSON.stringify(timing)}\n`);
}
