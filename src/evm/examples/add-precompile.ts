import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";
import { createAddressFromString } from "@ethereumjs/util";
import { Wasm } from "../wasm";
import fs from "fs";
import path from "path";

export const ADD_PRECOMPILE_ADDRESS = createAddressFromString(
    "0x0000000000000000000000000000000000000123"
);

export async function initAddWasm(): Promise<void> {
    const wasmPath = path.resolve(__dirname, "./add.wasm");
    try {
        const wasmSource = fs.readFileSync(wasmPath);
        await Wasm.init(wasmSource);
    } catch (err) {
        throw new Error(`Failed to read WASM file at ${wasmPath}: ${err}`);
    }
}

/**
 * Converts a 32-bit number to a 32-byte Uint8Array (big-endian, right-aligned).
 * EVM precompiles expect 32-byte return values, so this pads with zeros and puts the 4-byte value at the end.
 */
function to32Bytes(n: number, bytes_size = 4): Uint8Array {
    const buf = Buffer.alloc(bytes_size * 8);
    buf.writeUInt32BE(n, 32 - bytes_size); // Write as big-endian at the last 4 bytes
    return new Uint8Array(buf);
}

export function createAddPrecompile(): CustomPrecompile {
    return {
        address: ADD_PRECOMPILE_ADDRESS,
        function: ({ data, gasLimit }) => {
            // Validate input length - must be exactly 64 bytes (2 x 32 bytes)
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

            // Get the add function from WASM
            const add = Wasm.getExport<(a: number, b: number) => number>("add");

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
