// @spec-test-coverage-ignore: browser test-worker entry exercised by the browser worker gate
import { onUnhandledWorkerError } from "@/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "@/evm/contractExecutor/worker/protocol";
import {
    startWatchdogContractExecutorWorker,
    type WatchdogArmMessage,
    type WatchdogWorkerMode
} from "../watchdogContractExecutorWorkerCore";

// Construction-time selection rides in the worker name as JSON.
const selection = JSON.parse(self.name || "{}") as {
    mode?: WatchdogWorkerMode;
    armChannel?: string;
};
const mode = selection.mode ?? "watchdog";
const armChannel = selection.armChannel ?? "watchdog-arm";
const channel = new BroadcastChannel(armChannel);

startWatchdogContractExecutorWorker(mode, {
    post: (response: WorkerHostMessage) => {
        globalThis.postMessage(response);
    },
    onMessage: (handler: (message: WorkerRequestMessage) => void) => {
        globalThis.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
            handler(event.data);
        };
    },
    onDisposed: () => globalThis.close(),
    subscribeArm: (handler) => {
        channel.onmessage = (event: MessageEvent<WatchdogArmMessage>) => {
            if (event.data?.type !== "arm") return;
            handler();
        };
        return () => channel.close();
    },
    onUnhandledWorkerError
});
