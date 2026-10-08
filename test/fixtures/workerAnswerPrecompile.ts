// @spec-test-coverage-ignore: precompile module and manifests the worker suites load; the suites own the declarations
import type { EvmCustomPrecompileContext } from "@/evm/EvmFactory";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { isMainThread } from "node:worker_threads";

type WorkerAnswerPrecompileOptions = {
    delayMs?: number;
    expectedData: string;
    value: string;
    // unhandled rejection on a timer -> a genuine unhandledRejection in this thread
    crashAsync?: boolean;
    // answers only after this long -> a call still in flight when the thread ends
    callDelayMs?: number;
    // after the call delay, fail instead of answering
    failAfterDelay?: boolean;
    // ends the worker thread with this code instead of answering
    exitCode?: number;
};

export const WORKER_DELAYED_FAILURE_MESSAGE =
    "worker answer precompile failed after its delay";

export const WORKER_ASYNC_CRASH_MESSAGE =
    "worker answer precompile async crash";

/**
 * Owners the SDK handed this factory in the current realm, in creation order.
 * They never cross a port; a test in the same realm reads them.
 */
export const workerAnswerPrecompileOwners: AInternalRpcRoot[] = [];

export default async function createWorkerAnswerPrecompile(
    options: WorkerAnswerPrecompileOptions,
    context?: EvmCustomPrecompileContext
) {
    if (context?.owner) workerAnswerPrecompileOwners.push(context.owner);
    if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return async function workerAnswerPrecompile(input: PrecompileInput) {
        if (ethers.hexlify(input.data) !== options.expectedData) {
            throw new Error("Unexpected precompile calldata");
        }

        if (options.exitCode !== undefined) process.exit(options.exitCode);
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
        if (options.failAfterDelay)
            throw new Error(WORKER_DELAYED_FAILURE_MESSAGE);

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
