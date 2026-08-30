type Rpc = {
    service: string;
    method: string;
    params: any[];
    /**
     * Present only for request/response RPCs. Its presence signals that the
     * receiver must reply with an `RpcResponse` carrying the same `requestId`.
     * Absent for fire-and-forget RPCs (broadcast/sendOne/sendMultiple).
     */
    requestId?: string;
};

export const RPC_GUARD_REJECTION_ERROR = "RPC request rejected by guard";

/**
 * Reply to a request-style RPC. Correlated back to the originating
 * `RpcHandler.request(...)` call via `requestId`.
 */
export type RpcResponse = {
    rpcResponse: true;
    requestId: string;
    ok: boolean;
    result?: any;
    error?: string;
};

// Upper bound on a single RPC frame's size, enforced before parsing/dispatch so
// an oversized frame can't force unbounded JSON.parse/handler work. Generous so
// no legitimate payload (e.g. an encoded sync payload) is rejected; it only
// caps absurd floods.
export const MAX_RPC_FRAME_BYTES = 16 * 1024 * 1024;

// RPC params/results must be JSON-serializable: every `*RpcMethods` endpoint
// takes and returns plain values, with bigint-bearing ethers structs crossing as
// `Codec.encode`d `encoded*` strings (one serialization mechanism — Codec). A
// raw BigInt is therefore a contract violation, and `JSON.stringify` throws on
// it by design — surfacing the offending method instead of silently coercing it
// to a lossy number. (The harness deliberately does NOT install a
// `BigInt.prototype.toJSON` shim, so this throw holds in tests too.)
export function serializeRpc(rpc: Rpc): string {
    return JSON.stringify(rpc);
}
export function deserializeRpc(serializedRpc: string): Rpc | undefined {
    try {
        const rpc = JSON.parse(serializedRpc);
        if (
            !rpc ||
            typeof rpc.service !== "string" ||
            typeof rpc.method !== "string" ||
            // `params` must be an array — the dispatcher spreads it
            // (`method(...rpc.params)`), so a non-array would mis-dispatch.
            !Array.isArray(rpc.params) ||
            (rpc.requestId !== undefined && typeof rpc.requestId !== "string")
        ) {
            return undefined;
        }
        return rpc as Rpc;
    } catch {
        return undefined;
    }
}

export function serializeRpcResponse(response: RpcResponse): string {
    return JSON.stringify(response);
}
export function deserializeRpcResponse(
    serialized: string
): RpcResponse | undefined {
    try {
        const response = JSON.parse(serialized);
        if (
            !response ||
            response.rpcResponse !== true ||
            typeof response.requestId !== "string" ||
            typeof response.ok !== "boolean"
        ) {
            return undefined;
        }
        return response as RpcResponse;
    } catch {
        return undefined;
    }
}

export default Rpc;
