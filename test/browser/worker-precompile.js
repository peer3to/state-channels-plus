import { ethers } from "ethers";

export default function createBrowserWorkerAnswerPrecompile(options) {
    return async function browserWorkerAnswerPrecompile(input) {
        const calldata = ethers.hexlify(input.data);
        if (calldata !== options.expectedData) {
            throw new Error(
                `Unexpected precompile calldata: ${calldata}, expected ${options.expectedData}`
            );
        }

        // an unhandled rejection on a timer -> a genuine crash of this realm
        if (options.crashAsync) {
            setTimeout(() => {
                void Promise.reject(
                    new Error("browser worker answer precompile async crash")
                );
            }, 0);
        }

        const isWorker =
            typeof WorkerGlobalScope !== "undefined" &&
            globalThis instanceof WorkerGlobalScope &&
            typeof document === "undefined";

        return {
            executionGasUsed: 0n,
            returnValue: ethers.getBytes(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "bool"],
                    [BigInt(options.value), isWorker]
                )
            )
        };
    };
}
