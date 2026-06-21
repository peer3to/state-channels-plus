import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { isMainThread } from "node:worker_threads";

type WorkerAnswerPrecompileOptions = {
    expectedData: string;
    value: string;
};

export default function createWorkerAnswerPrecompile(
    options: WorkerAnswerPrecompileOptions
) {
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
