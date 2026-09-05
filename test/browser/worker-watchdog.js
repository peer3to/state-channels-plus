// @spec-test-coverage-ignore: browser page script for the watchdog smoke; evidence is mapped from run-worker-contract-executor.mjs
import { Buffer } from "buffer";
import { ethers } from "ethers";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

const { default: WorkerContractExecutor } = await import(
    "../../src/evm/contractExecutor/WorkerContractExecutor.ts"
);
const { createContractExecutorWorkerFromUrl } = await import(
    "../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts"
);
const {
    WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
    WATCHDOG_WORKER_ORIGINAL_ERROR,
    WATCHDOG_WORKER_TRIPPED_DELAY_MS
} = await import("../evm/workers/watchdogContractExecutorWorkerCore.ts");

const LOG_ONLY_INIT_CODE = (() => {
    const topic = ethers.id("ValueSet(uint256)");
    const runtime = `0x602a6000527f${topic.slice(2)}60206000a160006000f3`;
    const runtimeSize = ethers
        .getBytes(runtime)
        .length.toString(16)
        .padStart(2, "0");
    return `0x60${runtimeSize}600c60003960${runtimeSize}6000f3${runtime.slice(2)}`;
})();

function waitFor(condition, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (condition()) return resolve();
            if (Date.now() - startedAt > timeoutMs) {
                return reject(new Error("Condition not met in time"));
            }
            setTimeout(poll, 50);
        };
        poll();
    });
}

/**
 * One browser executor whose worker is the scripted watchdog entry. The
 * report must arrive as one detached error while the executor keeps serving;
 * the browser must not see it as a worker `error` event (that would be a
 * fatal failure and a console error, which the gate counts as a failure).
 */
async function runMode(mode) {
    const armChannel = `watchdog-arm-${crypto.randomUUID()}`;
    const reports = [];
    const executor = await WorkerContractExecutor.create([], undefined, {
        createWorkerRuntime: (onMessage, onError) =>
            createContractExecutorWorkerFromUrl(
                new URL(
                    "../evm/workers/browser/watchdogContractExecutorWorkerEntry.ts",
                    import.meta.url
                ),
                onMessage,
                onError,
                JSON.stringify({ mode, armChannel })
            ),
        onDetachedError: (error) => {
            reports.push(error);
        }
    });
    const sender = new BroadcastChannel(armChannel);
    try {
        // Nothing may trip before the arm: the scripted source stays quiet
        // and no autonomous throw is scheduled.
        await new Promise((resolve) => setTimeout(resolve, 400));
        const reportsBeforeArm = reports.length;
        sender.postMessage({ type: "arm" });
        await waitFor(() => reports.length >= 1, 15_000);
        const deployment = await executor.deploy(LOG_ONLY_INIT_CODE);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const [report] = reports;
        return {
            message: report.message,
            eventLoopDelay: report.eventLoopDelay ?? null,
            reportsBeforeArm,
            reportCount: reports.length,
            servedAfterReport: typeof deployment.createdAddress === "string"
        };
    } finally {
        sender.close();
        await executor.dispose();
    }
}

globalThis.runContractExecutorWorkerWatchdogBrowserSmoke = async () => ({
    expected: {
        watchdogMessage: `Event loop delay ${WATCHDOG_WORKER_TRIPPED_DELAY_MS}ms exceeded configured threshold ${WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS}ms`,
        originalError: WATCHDOG_WORKER_ORIGINAL_ERROR,
        trippedDelayMs: WATCHDOG_WORKER_TRIPPED_DELAY_MS
    },
    watchdog: await runMode("watchdog"),
    throw: await runMode("throw"),
    rejection: await runMode("rejection")
});
