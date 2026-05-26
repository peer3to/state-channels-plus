// W3 - error serialize/deserialize. {name, message, stack} is the debugger
// contract that matters. no cause-chain walk, no aggregate, no wrapper class.

import type { SerializedError } from "./rpc-types";

export function serializeError(e: unknown): SerializedError {
    if (e instanceof Error) {
        return { name: e.name, message: e.message, stack: e.stack };
    }
    return { name: "Error", message: String(e) };
}

export function deserializeError(s: SerializedError): Error {
    const err = new Error(s.message);
    err.name = s.name;
    if (s.stack) err.stack = s.stack;
    return err;
}
