import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { isMainThread } from "node:worker_threads";

type WorkerAnswerPrecompileOptions = {
    delayMs?: number;
    expectedData: string;
    value: string;
};

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
