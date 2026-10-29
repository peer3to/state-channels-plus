// @spec-test-coverage-ignore: test-owned real worker selection; executable cases are declared in worker and root test files
import { resolveRuntimeModulePath } from "@/utils/moduleLoader/node/resolveRuntimeModulePath";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { WorkerOptions } from "node:worker_threads";
import type * as WorkerThreads from "node:worker_threads";

const workers: typeof WorkerThreads = createRequire(__filename)(
    "node:worker_threads"
);

/** Launch real scripted workers from test infrastructure, without SDK setup overrides. */
export class RootWorkerControl {
    public static async run<T>(
        kind: "sdk" | "vm",
        entry: {
            workerUrl?: string | URL;
            workerData?: unknown;
            name?: string;
            onWorker?: (worker: WorkerThreads.Worker) => void;
        },
        operation: () => Promise<T>
    ): Promise<T> {
        if (!entry.workerUrl) return operation();
        // The substituted entry bypasses the SDK's worker factory, so map it
        // to the twin that exists in the running tree here.
        const entryPath = resolveRuntimeModulePath(
            entry.workerUrl instanceof URL
                ? fileURLToPath(entry.workerUrl)
                : entry.workerUrl
        );
        const NativeWorker = workers.Worker;
        class ScriptedWorker extends NativeWorker {
            constructor(filename: string | URL, options?: WorkerOptions) {
                const selected = String(filename).includes(
                    kind === "vm"
                        ? "ContractExecutorRoot"
                        : "P2pRuntimeHostRoot"
                );
                super(
                    selected ? entryPath : filename,
                    selected
                        ? {
                              ...options,
                              workerData: entry.workerData,
                              name: entry.name ?? options?.name
                          }
                        : options
                );
                if (selected) entry.onWorker?.(this);
            }
        }
        Reflect.set(workers, "Worker", ScriptedWorker);
        try {
            return await operation();
        } finally {
            Reflect.set(workers, "Worker", NativeWorker);
        }
    }
}
