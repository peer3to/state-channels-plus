import P2PManager from "../P2PManager";
import ATransport from "../transport/ATransport";
import Rpc, { createMessageContent, serializeRpc } from "./Rpc";

type UnsignedRpc = Omit<Rpc, "signature">;

class RpcHandler {
    private readonly rpcPayload: UnsignedRpc;
    private readonly p2pManager: P2PManager;
    private signedRpcPromise: Promise<Rpc> | null = null;

    constructor(rpcPayload: UnsignedRpc, p2pManager: P2PManager) {
        this.rpcPayload = rpcPayload;
        this.p2pManager = p2pManager;
    }

    private async buildSignedRpc(): Promise<Rpc> {
        if (!this.signedRpcPromise) {
            this.signedRpcPromise = (async () => {
                const messageContent = createMessageContent(
                    this.rpcPayload.service,
                    this.rpcPayload.method,
                    this.rpcPayload.params,
                    this.rpcPayload.timestamp
                );
                const signature =
                    await this.p2pManager.p2pSigner.signMessage(messageContent);
                return {
                    ...this.rpcPayload,
                    signature
                };
            })();
        }
        return this.signedRpcPromise;
    }

    private async getSerializedRpc(): Promise<string> {
        const signedRpc = await this.buildSignedRpc();
        return serializeRpc(signedRpc);
    }

    public async broadcast(): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        this.p2pManager.broadcastRpc(serializedRpc);
    }

    public async sendOne(transport: ATransport): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        transport.send(serializedRpc);
    }

    public async sendMultiple(transports: ATransport[]): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        transports.forEach((transport) => {
            transport.send(serializedRpc);
        });
    }
}

export default RpcHandler;
