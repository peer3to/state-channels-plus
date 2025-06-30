import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";
import { createAddressFromString } from "@ethereumjs/util";
import { Wasm } from "../wasm";
import fs from "fs";
import path from "path";
import { to32Bytes } from "./util";

export const MATH_PRECOMPILE_ADDRESS = createAddressFromString(
    "0x0000000000000000000000000000000000000124"
);

// Initialize WASM module
export function initMathWasm(): Promise<Wasm> {
    const wasmPath = path.resolve(__dirname, "./math.wasm");
    try {
        const wasmSource = fs.readFileSync(wasmPath);
        return Wasm.init(wasmSource);
    } catch (err) {
        throw new Error(
            `Failed to read or initialize WASM file at ${wasmPath}: ${err}`
        );
    }
}

export async function createMathPrecompile(): Promise<CustomPrecompile> {
    const mathWasm = await initMathWasm();

    return {
        address: MATH_PRECOMPILE_ADDRESS,
        function: ({ data }) => {
            if (!data || data.length !== 96) {
                throw new Error(
                    `Invalid input length: expected 96 bytes (32 selector + 64 params), got ${data?.length ?? 0} bytes`
                );
            }

            // First 32 bytes are function selector
            const selector = Number(
                BigInt("0x" + Buffer.from(data.slice(0, 32)).toString("hex"))
            );

            // Map selector to WASM function name
            const funcName = {
                0: "add",
                1: "multiply",
                2: "divide"
            }[selector];

            if (!funcName) {
                throw new Error(`Invalid function selector: ${selector}`);
            }

            // Get parameters from remaining bytes
            const a = Number(
                BigInt("0x" + Buffer.from(data.slice(32, 64)).toString("hex")) &
                    0xffffffffn
            );
            const b = Number(
                BigInt("0x" + Buffer.from(data.slice(64, 96)).toString("hex")) &
                    0xffffffffn
            );

            const func =
                mathWasm.getExport<(a: number, b: number) => number>(funcName);
            const result = func(a, b);

            return {
                returnValue: to32Bytes(result),
                gasUsed: 1000n,
                executionGasUsed: 1000n
            };
        }
    };
}
