// @spec-test-coverage-ignore: shared test-worker core exercised by the mapped watchdog test declarations
import {
    createContractExecutorWorkerHost,
    type ContractExecutorWorkerHostHandle
} from "@/evm/contractExecutor/worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "@/evm/contractExecutor/worker/protocol";
import type {
    PerformanceSample,
    PerformanceSampleSource
} from "@/utils/logging/performanceMonitorInternal";

/**
 * Which autonomous error the test worker produces. The first three are armed
 * by the test; `post-start` throws in the first microtask after the host
 * starts, the earliest moment after readiness, with no arm.
 */
export type WatchdogWorkerMode =
    | "watchdog"
    | "throw"
    | "rejection"
    | "post-start";

export const WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS = 100;
export const WATCHDOG_WORKER_TRIPPED_DELAY_MS = 1000;
export const WATCHDOG_WORKER_ORIGINAL_ERROR =
    "Stubbed autonomous worker failure";

/** Arm-channel message; anything else on the channel is ignored. */
export type WatchdogArmMessage = { type: "arm" };

/**
 * Synthetic runs are silent by config: the worker's own log of the report
 * would carry the watchdog message into the runner log and trip its
 * starvation classifier, and the timing marker would report a synthetic peak.
 * The scripted threshold below still trips the monitor.
 */
function silenceInit(message: WorkerRequestMessage): WorkerRequestMessage {
    if (message.type !== "request" || message.payload.type !== "init") {
        return message;
    }
    return {
        ...message,
        payload: {
            ...message.payload,
            config: {
                ...message.payload.config,
                LOG_SKIP_WRITING: true,
                EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0
            }
        }
    };
}

/**
 * One scripted delay sample source: below threshold until armed, then one
 * sample over threshold. Deterministic by construction; scheduler delay never
 * enters the picture.
 */
export function createScriptedSampleSource(): PerformanceSampleSource & {
    arm(): void;
} {
    let armed = false;
    const quiet: PerformanceSample = {
        dMean: 1,
        d50: 1,
        d90: 1,
        d99: 1,
        dMax: 1,
        utilization: 0.01
    };
    return {
        arm() {
            armed = true;
        },
        start() {},
        sample() {
            if (!armed) return quiet;
            return {
                ...quiet,
                dMax: WATCHDOG_WORKER_TRIPPED_DELAY_MS
            };
        },
        reset() {},
        stop() {}
    };
}

export type WatchdogWorkerPort = {
    post: (response: WorkerHostMessage) => void;
    onMessage: (handler: (message: WorkerRequestMessage) => void) => void;
    onDisposed?: () => void;
    /** Platform arm subscription; resolves the unsubscribe once armed. */
    subscribeArm: (handler: () => void) => () => void;
    /** Platform unhandled-error funnel registration (the sdk worker's helper). */
    onUnhandledWorkerError: (handler: (error: unknown) => void) => void;
};

/**
 * Runs the real contract-executor host core with the scripted sample source
 * and the real error funnel. Nothing trips until the arm message arrives; the
 * arm subscription is one-shot and closes itself after the first valid arm.
 */
export function startWatchdogContractExecutorWorker(
    mode: WatchdogWorkerMode,
    port: WatchdogWorkerPort
): ContractExecutorWorkerHostHandle {
    const sampleSource = createScriptedSampleSource();
    // Same order as the production entries: the funnel is registered on the
    // handle before request handling and readiness.
    const host = createContractExecutorWorkerHost(port.post, {
        monitorOptions: {
            threadLabel: "vm",
            sampleSource,
            delayErrorThresholdMs: WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
            intervalMs: 50
        }
    });
    port.onUnhandledWorkerError(host.reportUnhandledError);
    host.start(
        (handler) => port.onMessage((message) => handler(silenceInit(message))),
        port.onDisposed
    );
    if (mode === "post-start") {
        queueMicrotask(() => {
            throw new Error(WATCHDOG_WORKER_ORIGINAL_ERROR);
        });
        return host;
    }

    const unsubscribe = port.subscribeArm(() => {
        unsubscribe();
        if (mode === "watchdog") {
            sampleSource.arm();
            return;
        }
        if (mode === "throw") {
            setTimeout(() => {
                throw new Error(WATCHDOG_WORKER_ORIGINAL_ERROR);
            }, 0);
            return;
        }
        setTimeout(() => {
            void Promise.reject(new Error(WATCHDOG_WORKER_ORIGINAL_ERROR));
        }, 0);
    });
    return host;
}
