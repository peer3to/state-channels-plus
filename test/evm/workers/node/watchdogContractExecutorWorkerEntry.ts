// @spec-test-coverage-ignore: Node test-worker entry exercised by the mapped watchdog test declarations
import {
    startWatchdogContractExecutorWorker,
    type WatchdogArmMessage,
    type WatchdogWorkerMode
} from "../watchdogContractExecutorWorkerCore";
import type { ContractExecutorInitialization } from "@/rpc/internal/services/contractExecutor/ContractExecutorService";
import { onUnhandledWorkerError } from "@platform/rootWorkerRuntime";
import {
    onRootBootstrap,
    adaptTransferredPort
} from "@platform/rootWorkerRuntime";
import { BroadcastChannel, parentPort, workerData } from "node:worker_threads";

/**
 * Scripted selection installed by RootWorkerControl. `prefunnel` fails at
 * load, before any funnel exists; `exit` ends the thread once armed, after
 * the host is ready; `exit-pending` swallows the first call request so it
 * stays in flight, then ends the thread once armed. All three are the fatal
 * boundary, not report-and-continue.
 */
export type WatchdogWorkerData = {
    mode: WatchdogWorkerMode | "prefunnel" | "exit" | "exit-pending";
    armChannel: string;
};

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

const port = parentPort;
const data = workerData as WatchdogWorkerData;

// Pre-funnel mode: fail synchronously before any handler or host exists. This
// is the fatal bootstrap boundary, not report-and-continue.
if (data.mode === "prefunnel") {
    throw new Error("Stubbed pre-funnel worker failure");
}

// The installed Node types expose only close() and postMessage(); unref() is
// runtime-only, so it is reached through a local structural type.
const channel = new BroadcastChannel(data.armChannel) as BroadcastChannel & {
    unref?: () => void;
};
channel.unref?.();

const exitOnArm = data.mode === "exit" || data.mode === "exit-pending";
const mode: WatchdogWorkerMode =
    data.mode === "throw" ||
    data.mode === "rejection" ||
    data.mode === "post-start"
        ? data.mode
        : "watchdog";
globalThis.threadName = "vm";
onRootBootstrap<ContractExecutorInitialization>(
    async ({ port: transferredPort, payload }) => {
        await startWatchdogContractExecutorWorker(
            mode,
            {
                runtimePort: adaptTransferredPort(transferredPort),
                // Close the port so the drained loop can exit naturally (see
                // workerShutdown.ts for why the loop must never be force-stopped).
                onDisposed: () => port.close(),
                subscribeArm: (handler) => {
                    channel.onmessage = (message: unknown) => {
                        const payload = (
                            message as { data?: WatchdogArmMessage }
                        )?.data;
                        if (payload?.type !== "arm") return;
                        if (exitOnArm) {
                            // Unexpected exit after readiness, with a clean code.
                            process.exit(0);
                        }
                        handler();
                    };
                    // One-shot: close the receiver after the first valid arm so the
                    // worker holds no channel handle while it drains.
                    return () => channel.close();
                },
                onUnhandledWorkerError
            },
            payload
        );
    }
);
