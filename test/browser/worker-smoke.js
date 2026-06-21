import { Buffer } from "buffer";
import { ethers } from "ethers";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

const { default: WorkerContractExecutor } = await import(
    "../../src/evm/contractExecutor/WorkerContractExecutor.ts"
);

const CUSTOM_ADDRESS = "0x00000000000000000000000000000000000000bb";

globalThis.runContractExecutorWorkerBrowserSmoke = async () => {
    const executor = await WorkerContractExecutor.create([
        {
            address: CUSTOM_ADDRESS,
            module: new URL("./worker-precompile.js", import.meta.url).href,
            options: {
                expectedData: "0x1234",
                value: "42"
            }
        }
    ]);

    try {
        const result = await executor.simulateCall("0x1234", CUSTOM_ADDRESS);
        const [value, isWorker] = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256", "bool"],
            result.returnValue
        );

        return {
            isWorker,
            value: value.toString()
        };
    } finally {
        await executor.dispose();
    }
};
