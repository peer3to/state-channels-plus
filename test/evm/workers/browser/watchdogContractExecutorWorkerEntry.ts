// @spec-test-coverage-ignore: browser test-worker entry exercised by the browser worker gate
// the evm stack reads node globals; in place before anything boots it
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";
import {
    startWatchdogContractExecutorWorker,
    type WatchdogArmMessage,
    type WatchdogWorkerMode
} from "../watchdogContractExecutorWorkerCore";
import { onUnhandledWorkerError } from "@/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { Buffer } from "buffer";

// Construction-time selection rides in the worker name as JSON.
const selection = JSON.parse(self.name || "{}") as {
    mode?: WatchdogWorkerMode;
    armChannel?: string;
};
const mode = selection.mode ?? "watchdog";
const armChannel = selection.armChannel ?? "watchdog-arm";
(globalThis as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

const channel = new BroadcastChannel(armChannel);

startWatchdogContractExecutorWorker(mode, {
    port: adaptWorkerScope(),
    subscribeArm: (handler) => {
        channel.onmessage = (event: MessageEvent<WatchdogArmMessage>) => {
            if (event.data?.type !== "arm") return;
            handler();
        };
        return () => channel.close();
    },
    onUnhandledWorkerError
});
