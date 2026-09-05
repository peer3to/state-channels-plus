// @spec-test-coverage-ignore: Node test-worker entry exercised by the mapped no-route executor case
import { BroadcastChannel, parentPort, workerData } from "node:worker_threads";
import path from "node:path";

import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { createContractExecutorWorkerFromPath } from "@/evm/contractExecutor/node/ContractExecutorWorkerRuntime";
import type { WatchdogWorkerData } from "./watchdogContractExecutorWorkerEntry";

/**
 * Runs one dedicated-worker executor with no detached-error route inside its
 * own thread, arms the scripted worker's throw, and reports what this
 * thread's uncaught-exception path received, plus whether the executor still
 * served a deployment afterwards. The test process's own error handlers are
 * never touched.
 */
export type NoRouteWorkerReport =
    | { type: "surfaced"; message: string; servedAfter: boolean }
    | { type: "failed"; message: string };

if (!parentPort) {
    throw new Error("No-route executor entry requires a parent port");
}
const port = parentPort;
const data = workerData as { armChannel: string; logOnlyInitCode: string };

const surfaced: Error[] = [];
process.on("uncaughtException", (error: Error) => {
    surfaced.push(error);
});

void (async () => {
    const scripted: WatchdogWorkerData = {
        mode: "throw",
        armChannel: data.armChannel
    };
    const executor = await createContractExecutor(
        { dedicatedThread: true },
        {
            createWorkerRuntime: (onMessage, onError) =>
                createContractExecutorWorkerFromPath(
                    path.join(
                        __dirname,
                        "watchdogContractExecutorWorkerEntry.ts"
                    ),
                    onMessage,
                    onError,
                    scripted
                )
        }
    );
    const sender = new BroadcastChannel(data.armChannel);
    try {
        sender.postMessage({ type: "arm" });
        const deadline = Date.now() + 10_000;
        while (surfaced.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (surfaced.length === 0) {
            throw new Error("no uncaught error surfaced on the owning thread");
        }
        const deployment = await executor.deploy(data.logOnlyInitCode);
        const report: NoRouteWorkerReport = {
            type: "surfaced",
            message: surfaced[0].message,
            servedAfter: typeof deployment.createdAddress === "string"
        };
        port.postMessage(report);
    } catch (error) {
        const report: NoRouteWorkerReport = {
            type: "failed",
            message: error instanceof Error ? error.message : String(error)
        };
        port.postMessage(report);
    } finally {
        sender.close();
        await executor.dispose();
    }
})();
