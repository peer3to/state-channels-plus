import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";
import { createAddressFromString } from "@ethereumjs/util";
import { Wasm } from "../wasm";
import path from "path";

export const MATH_PRECOMPILE_ADDRESS = createAddressFromString(
    "0x0000000000000000000000000000000000000124"
);

export function initMathWasm(): Promise<Wasm> {
    const wasmPath = path.resolve(__dirname, "./math.wasm");
    return Wasm.load(wasmPath);
}

export async function createMathPrecompile(): Promise<CustomPrecompile> {
    const mathWasm = await initMathWasm();
    const math =
        mathWasm.getExport<(ptr: number, len: number) => number>("math");

    const offset = 1024;

    return {
        address: MATH_PRECOMPILE_ADDRESS,
        function: ({ data }) => {
            // Copy data into wasm memory at offset
            const memoryView = new Uint8Array(mathWasm.memory.buffer);
            memoryView.set(data, offset);

            // get pointer to result in wasm memory
            const resultPtr = math(offset, data.length);

            // read result from wasm memory
            const result = new Uint8Array(
                memoryView.slice(resultPtr, resultPtr + 32)
            );

            return {
                returnValue: result,
                executionGasUsed: 1n
            };
        }
    };
}
