// @spec-test-coverage-ignore: real worker teardown fault entry exercised by RootWorkerDrain.test.ts
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE } from "@/rpc/internal/node/RootWorkerRuntime";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { workerData } from "node:worker_threads";
// @ts-expect-error - udx-native does not ship TypeScript declarations.
import UDX from "udx-native";

/** Longer than the drain bound, so the timer is still pending when it fires. */
const LEAKED_TIMER_MS = 60 * 60 * 1000;

class TeardownExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.start to install the selected teardown fault.
    public override async start(
        ...args: Parameters<ContractExecutorRoot["start"]>
    ): Promise<void> {
        await super.start(...args);
        if (workerData.fault === "unrequested-exit")
            // End the live worker with the drain-timeout code while its parent
            // waits for this reply; the parent never asked for shutdown.
            this.lifecycle.quiesce = () =>
                process.exit(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
        if (workerData.fault === "native-socket")
            // A bound native udx socket: libuv holds it, Node does not list
            // it, so closeRootWorker cannot close it.
            new UDX().createSocket().bind(0);
    }

    // Overrides ContractExecutorRoot.dispose to fail the report collection
    // and leave a referenced timer, so the drain bound fires.
    public override dispose(): Promise<void> {
        if (workerData.fault === "report-fails") {
            // A single-runtime worker: the fault dies with the thread.
            process.report.getReport = () => {
                throw new Error("Staged report failure");
            };
            setInterval(() => {}, LEAKED_TIMER_MS);
        }
        return super.dispose();
    }
}

startRootWorker(TeardownExecutorRoot);
