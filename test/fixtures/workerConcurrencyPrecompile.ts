import type { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";

type WorkerConcurrencyPrecompileOptions = {
    delayMs: number;
};

export default function createWorkerConcurrencyPrecompile(
    options: WorkerConcurrencyPrecompileOptions
) {
    let activeCalls = 0;
    let maximumActiveCalls = 0;

    return async function workerConcurrencyPrecompile(_input: PrecompileInput) {
        activeCalls += 1;
        maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        activeCalls -= 1;

        return {
            executionGasUsed: 0n,
            returnValue: ethers.getBytes(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256"],
                    [maximumActiveCalls]
                )
            )
        };
    };
}
