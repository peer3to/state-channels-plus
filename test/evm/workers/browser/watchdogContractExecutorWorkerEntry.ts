// @spec-test-coverage-ignore: browser test-worker entry exercised by the browser worker gate
import {
    startWatchdogContractExecutorWorker,
    type WatchdogArmMessage,
    type WatchdogWorkerMode
} from "../watchdogContractExecutorWorkerCore";
import { onUnhandledWorkerError } from "@/rpc/internal/browser/RootWorkerRuntime";
import type { ContractExecutorInitialization } from "@/rpc/internal/services/contractExecutor/ContractExecutorService";
import {
    onRootBootstrap,
    adaptTransferredPort
} from "@platform/rootWorkerRuntime";

// Construction-time selection rides in the worker name as JSON.
const selection = JSON.parse(self.name || "{}") as {
    mode?: WatchdogWorkerMode;
    armChannel?: string;
};
const mode = selection.mode ?? "watchdog";
const armChannel = selection.armChannel ?? "watchdog-arm";
const channel = new BroadcastChannel(armChannel);

globalThis.threadName = "vm";
onRootBootstrap<ContractExecutorInitialization>(
    async ({ port: transferredPort, payload }) => {
        await startWatchdogContractExecutorWorker(
            mode,
            {
                runtimePort: adaptTransferredPort(transferredPort),
                onDisposed: () => globalThis.close(),
                subscribeArm: (handler) => {
                    channel.onmessage = (
                        event: MessageEvent<WatchdogArmMessage>
                    ) => {
                        if (event.data?.type !== "arm") return;
                        handler();
                    };
                    return () => channel.close();
                },
                onUnhandledWorkerError
            },
            payload
        );
    }
);
