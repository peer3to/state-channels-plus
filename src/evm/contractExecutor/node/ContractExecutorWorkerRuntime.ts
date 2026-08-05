import * as path from "node:path";
import * as fs from "node:fs";
import { Worker } from "node:worker_threads";
import { resolveWorkerResourceLimits } from "../../node/workerResourceLimits";
import { instrumentWorkerStartup } from "../../node/workerStartupTiming";
import { createWorkerShutdown } from "../../node/workerShutdown";
import type { WorkerLike } from "../types";
import type {
    WorkerRequestMessage,
    WorkerResponseMessage
} from "../worker/protocol";

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
        resourceLimits: resolveWorkerResourceLimits("vm")
    });
    const shutdownWorker = createWorkerShutdown(worker);
    let shuttingDown = false;
    instrumentWorkerStartup(
        worker,
        "vm",
        workerPath.endsWith(".ts")
            ? "ts-node-swc-transpile-only"
            : "compiled-js"
    );
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", (code: number) => {
        if (!shuttingDown && code !== 0) {
            onError(new Error(`Contract executor worker exited with ${code}`));
        }
    });
    return {
        postMessage: (message) => worker.postMessage(message),
        shutdown: async () => {
            shuttingDown = true;
            await shutdownWorker();
        }
    };
}
