import { RootWorkerControl } from "./RootWorkerControl";
// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    protocolEventTimeoutMs,
    MIN_TEST_TIME_CONFIG
} from "../../harness/core/testTimeConfig";
import type { EvmCustomPrecompileManifest } from "@/evm";
import contractExecutorRootUrl from "@platform/contractExecutorRootUrl";
import { createRootWorker } from "@platform/rootWorkerRuntime";
import type { WatchdogWorkerData } from "@test/evm/workers/node/watchdogContractExecutorWorkerEntry";
import {
    applyCrashLogConfig,
    crashLogUploadOverrides
} from "@test/fixtures/logging/crashLogConfig";
import {
    createUploaderFixture,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";
import path from "node:path";

const WATCHDOG_WORKER_ENTRY = path.resolve(
    __dirname,
    "../../evm/workers/node/watchdogContractExecutorWorkerEntry.ts"
);
/** The scripted worker runtime for one executor, selected by `mode`. */
export function watchdogWorkerRuntime(mode: WatchdogWorkerData["mode"]) {
    const armChannel = `watchdog-arm-${randomUUID()}`;
    const workerData: WatchdogWorkerData = { mode, armChannel };
    return {
        armChannel,
        workerUrl: WATCHDOG_WORKER_ENTRY,
        workerData
    };
}

// schedules an unhandled rejection inside the worker thread; with a call delay
// the call that scheduled it is still unanswered when the thread ends
export function crashingPrecompile(
    address: string,
    callDelayMs?: number
): EvmCustomPrecompileManifest {
    return {
        address,
        module: path.resolve(__dirname, "../workerAnswerPrecompile.ts"),
        options: {
            expectedData: "0x1234",
            value: "42",
            crashAsync: true,
            ...(callDelayMs ? { callDelayMs } : {})
        }
    };
}

// points every realm's uploader at a real receiver, jitter off. the worker
// rebuilds config from the init payload.
export function useReceiver(receiver: LogReceiver) {
    const restoreConfig = applyCrashLogConfig(
        crashLogUploadOverrides(receiver.url)
    );
    const { logger } = createUploaderFixture({
        uploadEndpoint: receiver.url,
        sharedContext: {
            threadName: "sdk",
            peerAddress: ethers.Wallet.createRandom().address
        }
    });
    return {
        logger,
        dispose: () => {
            logger.dispose();
            restoreConfig();
        }
    };
}

export const createLogOnlyInitCode = (topic: string) => {
    const runtime = `0x602a6000527f${topic.slice(2)}60206000a160006000f3`;
    const runtimeBytes = ethers.getBytes(runtime);
    const runtimeSize = runtimeBytes.length.toString(16).padStart(2, "0");
    const header = `0x60${runtimeSize}600c60003960${runtimeSize}6000f3`;
    return `${header}${runtime.slice(2)}`;
};

export async function assertWorkerFailureOrder() {
    const { workerUrl, workerData } = watchdogWorkerRuntime("prefunnel");
    const errors: Error[] = [];
    const worker = await RootWorkerControl.run(
        "vm",
        { workerUrl, workerData },
        async () =>
            createRootWorker(contractExecutorRootUrl, (error) =>
                errors.push(error)
            )
    );
    try {
        // The load-time throw raises `error`, then the thread exits with
        // code 1; the runtime reports both and the executor keeps the
        // first. Here both must arrive, in that order.
        await waitFor(
            () => errors.length >= 2,
            protocolEventTimeoutMs(MIN_TEST_TIME_CONFIG),
            50
        );
        expect(errors[0].message).to.equal("Stubbed pre-funnel worker failure");
        expect(errors[1].message).to.equal("Root worker exited with 1");
    } finally {
        await worker.shutdown();
    }
}
