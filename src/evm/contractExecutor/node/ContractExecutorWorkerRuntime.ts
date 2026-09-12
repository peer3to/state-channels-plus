import { resolveWorkerResourceLimits } from "../../node/workerResourceLimits";
import { createWorkerShutdown } from "../../node/workerShutdown";
import { instrumentWorkerStartup } from "../../node/workerStartupTiming";
import type { ContractExecutorWorkerErrorHandler, WorkerLike } from "../types";
import type { RuntimePort } from "@/transport/RuntimePort";
import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

export function createContractExecutorWorker(
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    const jsWorkerPath = path.join(__dirname, "ContractExecutorWorkerEntry.js");
    const tsWorkerPath = path.join(__dirname, "ContractExecutorWorkerEntry.ts");
    const workerPath = fs.existsSync(jsWorkerPath)
        ? jsWorkerPath
        : tsWorkerPath;
    return createContractExecutorWorkerFromPath(workerPath, onError);
}

/**
 * Spawn a contract-executor worker from an explicit entry path. Production
 * uses the platform entry above; tests load a scripted entry and pass its
 * selection through `workerData`.
 */
export function createContractExecutorWorkerFromPath(
    workerPath: string,
    onError: ContractExecutorWorkerErrorHandler,
    workerData?: unknown
): WorkerLike {
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
        workerData,
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
    worker.on("error", onError);
    worker.on("exit", (code: number) => {
        // Any exit the executor did not ask for is fatal, code 0 included: a
        // worker that ends on its own cannot serve the pending requests.
        if (!shuttingDown) {
            onError(new Error(`Contract executor worker exited with ${code}`));
        }
    });
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
            shuttingDown = true;
            await shutdownWorker();
        }
    };
}
