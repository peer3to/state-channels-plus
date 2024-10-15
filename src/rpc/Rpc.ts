type Rpc = {
    method: string;
    params: any[];
};
export function serializeRpc(rpc: Rpc): string {
    return JSON.stringify(rpc);
}
export function deserializeRpc(serializedRpc: string): Rpc | undefined {
    try {
        let rpc = JSON.parse(serializedRpc);
        if (!rpc || typeof rpc.method !== "string" || !rpc.params) {
            return undefined;
        }
        return rpc as Rpc;
    } catch (e) {
        return undefined;
    }
}
export default Rpc;
