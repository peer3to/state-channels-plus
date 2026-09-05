// @spec-test-coverage-ignore: browser page script for the worker smokes; evidence is mapped from run-worker-contract-executor.mjs
import { Buffer } from "buffer";
import { ethers } from "ethers";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

// Registers the watchdog smoke on the same page.
import "./worker-watchdog.js";

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

// Runtime code: TIMESTAMP, MSTORE at 0, RETURN 32 bytes; the init code
// returns those nine bytes.
const TIMESTAMP_INIT_CODE = "0x684260005260206000f3600052600960" + "17f3";

// The browser worker builds the host's clock perception from the adjustment
// it receives at initialization: block.timestamp is wall time plus that
// adjustment, and it advances.
globalThis.runContractExecutorWorkerClockBrowserSmoke = async () => {
    const adjustmentSeconds = 600;
    const executor = await WorkerContractExecutor.create(
        [],
        undefined,
        {},
        adjustmentSeconds
    );
    try {
        const deployed = await executor.deploy(TIMESTAMP_INIT_CODE);
        const address = String(deployed.createdAddress);
        const read = async () =>
            Number(
                BigInt((await executor.executeCall("0x", address)).returnValue)
            );
        const first = await read();
        const wallFirst = Math.floor(Date.now() / 1000);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const second = await read();
        return {
            firstOffset: first - wallFirst,
            advanced: second > first
        };
    } finally {
        await executor.dispose();
    }
};
