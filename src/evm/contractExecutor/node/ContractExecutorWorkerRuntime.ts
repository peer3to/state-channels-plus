import * as path from "node:path";
import * as fs from "node:fs";
import { Worker } from "node:worker_threads";
import { resolveWorkerResourceLimits } from "../../node/workerResourceLimits";
import { instrumentWorkerStartup } from "../../node/workerStartupTiming";
import { createWorkerShutdown } from "../../node/workerShutdown";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { ContractExecutorWorkerErrorHandler, WorkerLike } from "../types";

export type { ContractExecutorWorkerErrorHandler };

export function createContractExecutorWorker(
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
    instrumentWorkerStartup(
        worker,
        "vm",
        workerPath.endsWith(".ts")
            ? "ts-node-swc-transpile-only"
            : "compiled-js"
    );
    worker.on("error", onError);
    // the worker as a port: what it posts is a frame, and its exit is the
    // line closing - the router settles what was pending on it
    const port: RuntimePort = {
        post: (message) => worker.postMessage(message),
        onMessage: (handler) => {
            worker.on("message", handler);
        },
        start: () => {},
        onClose: (handler) => {
            worker.on("exit", () => handler());
        },
        close: () => {}
    };
    return {
        port,
        shutdown: async () => {
            await shutdownWorker();
        }
    };
}
