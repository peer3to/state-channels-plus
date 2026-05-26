// W2 - error wire format for crash / log frames. distinct from W3's
// per-rpc error envelope because crash plumbing happens before the rpc kernel
// is ready (e.g. import-time exception).

export type WireError = {
    name: string;
    message: string;
    stack?: string;
};

export function toWireError(e: unknown): WireError {
    if (e instanceof Error) {
        return { name: e.name, message: e.message, stack: e.stack };
    }
    return { name: "Error", message: String(e) };
}
