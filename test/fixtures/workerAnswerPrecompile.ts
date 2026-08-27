import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { isMainThread } from "node:worker_threads";

type WorkerAnswerPrecompileOptions = {
    delayMs?: number;
    expectedData: string;
    value: string;
    // unhandled rejection on a timer -> a genuine unhandledRejection in this thread
    crashAsync?: boolean;
};

export const WORKER_ASYNC_CRASH_MESSAGE =
    "worker answer precompile async crash";

export default async function createWorkerAnswerPrecompile(
    options: WorkerAnswerPrecompileOptions
) {
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
