import * as path from "node:path";
import * as fs from "node:fs";
import { Worker } from "node:worker_threads";
import type {
    WorkerRequestMessage,
    WorkerResponseMessage
} from "../worker/protocol";

export type WorkerLike = {
    postMessage(message: WorkerRequestMessage): void;
    terminate?: () => Promise<unknown> | unknown;
};

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerResponseMessage
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;

export function createContractExecutorWorker(
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    const jsWorkerPath = path.join(__dirname, "ContractExecutorWorkerEntry.js");
    const tsWorkerPath = path.join(__dirname, "ContractExecutorWorkerEntry.ts");
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
