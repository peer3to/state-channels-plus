import type {
    ContractExecutorWorkerErrorHandler,
    ContractExecutorWorkerMessageHandler,
    WorkerLike
} from "../types";

export type {
    ContractExecutorWorkerErrorHandler,
    ContractExecutorWorkerMessageHandler,
    WorkerLike
};

export function createContractExecutorWorker(
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    const nodeRequire = typeof require === "function" ? require : undefined;
    if (!nodeRequire) {
        throw new Error("Node worker_threads require() is unavailable");
    }

    const path = nodeRequire("node:path") as typeof import("node:path");
    const fs = nodeRequire("node:fs") as typeof import("node:fs");
    const { Worker } = nodeRequire(
        "node:worker_threads"
    ) as typeof import("node:worker_threads");

    const jsWorkerPath = path.join(__dirname, "ContractExecutorWorkerHost.js");
    const tsWorkerPath = path.join(__dirname, "ContractExecutorWorkerHost.ts");
    const workerPath = fs.existsSync(jsWorkerPath)
        ? jsWorkerPath
        : tsWorkerPath;
    const execArgv = workerPath.endsWith(".ts")
        ? ["-r", "ts-node/register", "-r", "tsconfig-paths/register"]
        : undefined;

    const worker = new Worker(workerPath, { execArgv });
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", (code: number) => {
        if (code !== 0) {
            onError(new Error(`Contract executor worker exited with ${code}`));
        }
    });
    return worker;
}
