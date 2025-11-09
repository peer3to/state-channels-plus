import { Hash } from "@/types/types";
import { ethers } from "ethers";
type Rpc = {
    service: string;
    method: string;
    params: any[];
    timestamp: number;
    signature: string;
};
export function serializeRpc(rpc: Rpc): string {
    return JSON.stringify(rpc);
}

export function createRpcSigningHash(
    service: string,
    method: string,
    params: any[],
    timestamp: number
): Hash {
    const signingContent = {
        service: service,
        method: method,
        params: params,
        timestamp: timestamp
    };
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(signingContent)));
}

export function createRpcSigningHashFromRpc(rpc: Rpc): Hash {
    return createRpcSigningHash(
        rpc.service,
        rpc.method,
        rpc.params,
        rpc.timestamp
    );
}

export function deserializeRpc(serializedRpc: string): Rpc | undefined {
    try {
        const rpc = JSON.parse(serializedRpc);
        if (
            !rpc ||
            typeof rpc.service !== "string" ||
            typeof rpc.method !== "string" ||
            !rpc.params ||
            typeof rpc.timestamp !== "number" ||
            typeof rpc.signature !== "string"
        ) {
            return undefined;
        }
        return rpc as Rpc;
    } catch (e) {
        return undefined;
    }
}
export default Rpc;
