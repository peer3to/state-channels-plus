import { parentPort, Worker, type MessagePort } from "node:worker_threads";
import * as path from "node:path";
import * as fs from "node:fs";
import { resolveWorkerResourceLimits } from "../../node/workerResourceLimits";
import { instrumentWorkerStartup } from "../../node/workerStartupTiming";
import { startCpuProfilerIfEnabled } from "../../node/workerCpuProfiler";
import { createWorkerShutdown } from "../../node/workerShutdown";
import type {
    P2pRuntimeWorker,
    RuntimePort,
    WorkerBootstrapMessage
} from "../types";
import { adaptPort } from "./P2pRuntimeChannel";

export function createP2pRuntimeWorker(): P2pRuntimeWorker {
    const jsWorkerPath = path.join(
        __dirname,
        "..",
        "worker",
        "P2pRuntimeWorkerEntry.js"
    );
    const tsWorkerPath = path.join(
        __dirname,
        "..",
        "worker",
        "P2pRuntimeWorkerEntry.ts"
    );
    const workerPath = fs.existsSync(jsWorkerPath)
        ? jsWorkerPath
        : tsWorkerPath;
    return createP2pRuntimeWorkerFromPath(workerPath);
}

/**
 * Spawn the sdk worker from an explicit entry path. Production uses the
 * platform entry above; tests load an outer entry that builds a scripted
 * contract-executor worker and pass its selection through `workerData`.
 */
export function createP2pRuntimeWorkerFromPath(
    workerPath: string,
    workerData?: unknown
): P2pRuntimeWorker {
    // Transpile-only: each worker re-loads the SDK import graph, and full
    // ts-node type-checks it (seconds per worker). Types are already checked by
    // `yarn tsc`, so skip the per-worker check.
    const execArgv = workerPath.endsWith(".ts")
        ? [
              "-r",
              "ts-node/register/transpile-only",
              "-r",
              "tsconfig-paths/register"
          ]
        : undefined;

    const worker = new Worker(workerPath, {
        execArgv,
        workerData,
        resourceLimits: resolveWorkerResourceLimits("sdk")
    });
    const shutdownWorker = createWorkerShutdown(worker);
    instrumentWorkerStartup(
        worker,
        "sdk",
        workerPath.endsWith(".ts")
            ? "ts-node-swc-transpile-only"
            : "compiled-js"
    );
    return {
        postMessage: (value, transfer) =>
            worker.postMessage(value, transfer as readonly MessagePort[]),
        shutdown: async () => {
            await shutdownWorker();
        }
    };
}

/**
 * Register the worker bootstrap handler (Node `worker_threads`). The parent
 * sends a single {@link WorkerBootstrapMessage} carrying the serialized setup
 * payload and the transferred runtime port.
 */
export function onWorkerBootstrap(
    handler: (message: WorkerBootstrapMessage) => void
): void {
    if (!parentPort) {
        throw new Error(
            "startP2pRuntimeWorker must be executed inside a worker thread"
        );
    }
    startCpuProfilerIfEnabled("sdk");
    parentPort.once("message", (data) =>
        handler(data as WorkerBootstrapMessage)
    );
}

/** Initiate closing a lingering handle; the loop drain awaits completion. */
function closeHandle(handle: any): void {
    // Sockets and streams (provider keep-alive sockets, torn-transport WS).
    if (typeof handle.destroy === "function") return void handle.destroy();
    // Timers — clearTimeout accepts a Timeout from setInterval too.
    if (typeof handle.refresh === "function") return clearTimeout(handle);
    // Servers, message ports, and other closeables.
    if (typeof handle.close === "function") return void handle.close();
    handle.unref?.();
}

/**
 * Close the worker's remaining handles after disposal so its event loop can
 * drain and the thread exits on its own (see workerShutdown.ts for why the
 * loop must never be force-stopped).
 */
export async function closeWorkerBootstrapPort(): Promise<void> {
    const port = parentPort;
    if (!port) return;

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
    port.close();
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
    handler: (error: unknown) => void
): void {
    process.on("unhandledRejection", (reason) => handler(reason));
    process.on("uncaughtException", (error) => handler(error));
}
