import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";
import { createAddressFromString } from "@ethereumjs/util";
import { Wasm } from "./wasm";
import { wasmBase64 } from "./calculator";

// Define a fixed address for the calculator precompile
export const CALCULATOR_PRECOMPILE_ADDRESS = createAddressFromString(
    "0x0000000000000000000000000000000000000125"
);

export async function createCalculatorPrecompile(): Promise<CustomPrecompile> {
    // Initialize WASM module from base64 string
    const calculatorWasm = await Wasm.fromBase64(wasmBase64);

    // Get the exported calculator function from WASM
    const calculator =
        calculatorWasm.getExport<(ptr: number, len: number) => number>(
            "calculator"
        );

    // Define memory offset for input data
    const offset = 1024;

    return {
        address: CALCULATOR_PRECOMPILE_ADDRESS,
        function: ({ data }) => {
            // Copy input data into WASM memory
            const memoryView = new Uint8Array(calculatorWasm.memory.buffer);
            memoryView.set(data, offset);

            // Call WASM function and get result pointer
            const resultPtr = calculator(offset, data.length);

            // Read result from WASM memory (assuming 32-byte result)
            const result = new Uint8Array(
                memoryView.slice(resultPtr, resultPtr + 32)
            );

            return {
                returnValue: result,
                executionGasUsed: 1n // Fixed gas cost for simplicity
            };
        }
    };
}
