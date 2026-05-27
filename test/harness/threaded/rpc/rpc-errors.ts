// W3 - error serialize/deserialize. {name, message, stack} is the debugger
// contract that matters. no cause-chain walk, no aggregate, no wrapper class.
// CustomEvmError fields are preserved so `isCustomEvmError(err)` still
// returns true on the orchestrator side after a wire round-trip.

import type { SerializedError } from "./rpc-types";

type CustomEvmShape = {
    isCustomError: true;
    errorDescription: {
        name: string;
        args: readonly unknown[];
        signature?: string;
        selector?: string;
    };
};

export function serializeError(e: unknown): SerializedError {
    if (e instanceof Error) {
        const out: SerializedError = {
            name: e.name,
            message: e.message,
            stack: e.stack
        };
        // step 1 - preserve CustomEvmError discriminator + parsed description
        const maybeCustom = e as Partial<CustomEvmShape>;
        if (
            maybeCustom.isCustomError === true &&
            maybeCustom.errorDescription
        ) {
            out.isCustomError = true;
            const d = maybeCustom.errorDescription;
            out.customError = {
                name: d.name,
                // ethers Result is array-like + frozen; copy to plain array
                args: Array.from(d.args ?? []),
                signature: d.signature,
                selector: d.selector
            };
        }
        return out;
    }
    return { name: "Error", message: String(e) };
}

export function deserializeError(s: SerializedError): Error {
    const err = new Error(s.message) as Error & Partial<CustomEvmShape>;
    err.name = s.name;
    if (s.stack) err.stack = s.stack;
    if (s.isCustomError && s.customError) {
        err.isCustomError = true;
        err.errorDescription = {
            name: s.customError.name,
            args: s.customError.args,
            signature: s.customError.signature,
            selector: s.customError.selector
        };
    }
    return err;
}
