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

export function createMessageContent(
    method: string,
    params: any[],
    timestamp: number
): string {
    const messageContent = {
        method: method,
        params: params,
        timestamp: timestamp
    };
    return JSON.stringify(messageContent);
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
