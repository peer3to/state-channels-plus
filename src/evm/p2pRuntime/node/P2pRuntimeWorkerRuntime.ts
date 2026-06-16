import { parentPort, type MessagePort } from "node:worker_threads";
import type {
    P2pRuntimeWorker,
    RuntimePort,
    WorkerBootstrapMessage
} from "../types";
import { adaptPort } from "./P2pRuntimeChannel";

export function createP2pRuntimeWorker(): P2pRuntimeWorker {
    const nodeRequire = typeof require === "function" ? require : undefined;
    if (!nodeRequire) {
        throw new Error("Node worker_threads require() is unavailable");
    }

    const path = nodeRequire("node:path") as typeof import("node:path");
    const fs = nodeRequire("node:fs") as typeof import("node:fs");
    const { Worker } = nodeRequire(
        "node:worker_threads"
    ) as typeof import("node:worker_threads");

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

    return new Worker(workerPath, { execArgv }) as unknown as P2pRuntimeWorker;
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
    parentPort.on("message", (data) => handler(data as WorkerBootstrapMessage));
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
