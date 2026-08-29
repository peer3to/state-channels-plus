// @spec-test-coverage-ignore: child-process fixture for the worker init failure case; no SDK behavior applies
import { createContractExecutorFactory } from "@/evm";
import { unloadableWorkerPrecompile } from "./workerAnswerPrecompile";

// asks for a worker whose evm init fails, reports the failure to the parent,
// then holds nothing else -> the process ends only if the worker was ended
async function main() {
    try {
        await createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [
                unloadableWorkerPrecompile(
                    "0x00000000000000000000000000000000000000c1"
                )
            ]
        });
        process.send?.({ kind: "created" });
    } catch (error) {
        process.send?.({ kind: "failed", message: (error as Error).message });
    }
}

void main();
