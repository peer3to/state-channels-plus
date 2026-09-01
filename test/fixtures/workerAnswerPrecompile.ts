// @spec-test-coverage-ignore: precompile module and manifests the worker suites load; the suites own the declarations
import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { isMainThread } from "node:worker_threads";
import type { EvmCustomPrecompileManifest } from "@/evm";

type WorkerAnswerPrecompileOptions = {
    delayMs?: number;
    expectedData: string;
    value: string;
    // unhandled rejection on a timer -> a genuine unhandledRejection in this thread
    crashAsync?: boolean;
    // answers only after this long -> a call still in flight when the thread ends
    callDelayMs?: number;
    // the same, raised while the factory is still building -> during evm init
    crashOnInit?: boolean;
};

export const WORKER_ASYNC_CRASH_MESSAGE =
    "worker answer precompile async crash";
export const WORKER_INIT_CRASH_MESSAGE = "worker answer precompile init crash";

/** a manifest for this module that crashes its thread: on the first call, or
 *  while the evm is still being built */
export function crashingWorkerPrecompile(
    address: string,
    crash: "onCall" | "onInit",
    callDelayMs?: number
): EvmCustomPrecompileManifest {
    return {
        address,
        module: __filename,
        options: {
            expectedData: "0x1234",
            value: "42",
            ...(crash === "onCall"
                ? { crashAsync: true }
                : { crashOnInit: true, delayMs: 100 }),
            ...(callDelayMs ? { callDelayMs } : {})
        }
    };
}

/** a manifest whose module has no factory export -> evm init fails outright */
export function unloadableWorkerPrecompile(
    address: string
): EvmCustomPrecompileManifest {
    return { address, module: __filename, exportName: "missing" };
}

export default async function createWorkerAnswerPrecompile(
    options: WorkerAnswerPrecompileOptions
) {
    if (options.crashOnInit) {
        setTimeout(() => {
            void Promise.reject(new Error(WORKER_INIT_CRASH_MESSAGE));
        }, 0);
    }
    if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return async function workerAnswerPrecompile(input: PrecompileInput) {
        if (ethers.hexlify(input.data) !== options.expectedData) {
            throw new Error("Unexpected precompile calldata");
        }

        if (options.crashAsync) {
            setTimeout(() => {
                void Promise.reject(new Error(WORKER_ASYNC_CRASH_MESSAGE));
            }, 0);
        }
        if (options.callDelayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, options.callDelayMs)
            );
        }

        return {
            executionGasUsed: 0n,
            returnValue: ethers.getBytes(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "bool"],
                    [BigInt(options.value), isMainThread]
                )
            )
        };
    };
}
