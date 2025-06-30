import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";
import { createAddressFromString } from "@ethereumjs/util";
import { Wasm } from "../wasm";
import fs from "fs";
import path from "path";
import { to32Bytes } from "./util";

export const ADD_PRECOMPILE_ADDRESS = createAddressFromString(
    "0x0000000000000000000000000000000000000123"
);

export async function initAddWasm(): Promise<Wasm> {
    const wasmPath = path.resolve(__dirname, "./add.wasm");
    try {
        const wasmSource = fs.readFileSync(wasmPath);
        return Wasm.init(wasmSource);
    } catch (err) {
        throw new Error(`Failed to read WASM file at ${wasmPath}: ${err}`);
    }
}

export async function createAddPrecompile(): Promise<CustomPrecompile> {
    const wasm = await initAddWasm();
    return {
        address: ADD_PRECOMPILE_ADDRESS,
        function: ({ data, gasLimit }) => {
            if (!data || data.length !== 64) {
                throw new Error(
                    `Invalid input length: expected 64 bytes, got ${data?.length ?? 0} bytes`
                );
            }

            // Convert 32-byte big-endian slices to BigInt
            const a = BigInt(
                "0x" + Buffer.from(data.slice(0, 32)).toString("hex")
            );
            const b = BigInt(
                "0x" + Buffer.from(data.slice(32, 64)).toString("hex")
            );

            const add = wasm.getExport<(a: number, b: number) => number>("add");

            const result = add(
                Number(a & 0xffffffffn),
                Number(b & 0xffffffffn)
            );

            return {
                returnValue: to32Bytes(result),
                gasUsed: 1000n,
                executionGasUsed: 1000n
            };
        }
    };
}
