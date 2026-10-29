// @spec-test-coverage-ignore: projections for the real frame parser's mapped tests
import { deserializeRpcFrame } from "@/rpc/Rpc";

export function deserializeRpc(serialized: string) {
    const frame = deserializeRpcFrame(serialized);
    return frame?.kind === "request" ? frame.rpc : undefined;
}

export function deserializeRpcResponse(serialized: string) {
    const frame = deserializeRpcFrame(serialized);
    return frame?.kind === "response" ? frame.response : undefined;
}
