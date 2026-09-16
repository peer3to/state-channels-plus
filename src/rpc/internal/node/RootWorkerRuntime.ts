import "../threadName";
import type { RootWorker } from "../createRoot";
import { startCpuProfilerIfEnabled } from "@/evm/node/workerCpuProfiler";
import { resolveWorkerResourceLimits } from "@/evm/node/workerResourceLimits";
import { createWorkerShutdown } from "@/evm/node/workerShutdown";
import { instrumentWorkerStartup } from "@/evm/node/workerStartupTiming";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import type { RuntimePort } from "@/transport/RuntimePort";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort, Worker, type MessagePort } from "node:worker_threads";

/** Resolve a package root module for compiled Node or the source test runner. */
export function rootWorkerUrl(file: string): string {
    const compiled = path.join(__dirname, "../roots", file);
    return fs.existsSync(compiled)
        ? compiled
        : compiled.replace(/\.js$/, ".ts");
}

export function createRootWorker(
    url: string | URL,
    onError: (error: Error) => void,
    threadName?: string
): RootWorker & { shutdown(): Promise<void> } {
    const workerPath = url instanceof URL ? fileURLToPath(url) : url;
    // Transpile-only (swc via tsconfig's ts-node.swc): each worker re-loads the
    // import graph, and full ts-node type-checks it (seconds + a retained TS
    // program per worker). Types are already checked by `yarn tsc`.
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
        name: threadName,
        resourceLimits: resolveWorkerResourceLimits()
    });
    const shutdownWorker = createWorkerShutdown(worker);
    let shuttingDown = false;
    let connected = false;
    const expectShutdown = () => {
        shuttingDown = true;
    };
    instrumentWorkerStartup(
        worker,
        threadName ?? "root",
        workerPath.endsWith(".ts")
            ? "ts-node-swc-transpile-only"
            : "compiled-js"
    );
    worker.on("error", onError);
    worker.on("exit", (code: number) => {
        // Any exit the owner did not ask for is fatal, code 0 included: a
        // worker that ends on its own cannot serve the pending requests.
        if (!shuttingDown)
            onError(new Error(`Root worker exited with ${code}`));
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
        startCpuProfilerIfEnabled(globalThis.threadName);
        void handler(message);
    });
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
export async function closeRootWorker(): Promise<void> {
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

export function reportRootStartupTiming(timing: {
    runtimeReadyMs: number;
    runtimeThread?: string;
}): void {
    process.stdout.write(`##E2E_TIMING## ${JSON.stringify(timing)}\n`);
}
