import P2PManager from "../P2PManager";
import ATransport from "../transport/ATransport";
import Rpc, { createRpcSigningHash, serializeRpc } from "./Rpc";
import { ethers } from "ethers";

type UnsignedRpc = Omit<Rpc, "signature">;

class RpcHandler {
    private readonly rpcPayload: UnsignedRpc;
    private readonly p2pManager: P2PManager;
    private signedRpc: Rpc | undefined;

    constructor(rpcPayload: UnsignedRpc, p2pManager: P2PManager) {
        this.rpcPayload = rpcPayload;
        this.p2pManager = p2pManager;
    }

    private async buildSignedRpc(): Promise<Rpc> {
        if (!this.signedRpc) {
            this.signedRpc = await (async () => {
                const signingHash = createRpcSigningHash(
                    this.rpcPayload.service,
                    this.rpcPayload.method,
                    this.rpcPayload.params,
                    this.rpcPayload.timestamp
                );
                const signature = await this.p2pManager.p2pSigner.signMessage(
                    ethers.getBytes(signingHash)
                );
                return {
                    ...this.rpcPayload,
                    signature
                };
            })();
        }
        return this.signedRpc;
    }

    private async getSerializedRpc(): Promise<string> {
        const signedRpc = await this.buildSignedRpc();
        return serializeRpc(signedRpc);
    }

    public async broadcast(): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        this.p2pManager.broadcastRpc(serializedRpc, true);
    }

    public async sendOne(transport: ATransport): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        const rateLimiter = this.p2pManager.getOutboundRateLimiter(transport);
        transport.send(serializedRpc, rateLimiter);
    }

    public async sendMultiple(transports: ATransport[]): Promise<void> {
        const serializedRpc = await this.getSerializedRpc();
        transports.forEach((transport) => {
            const rateLimiter =
                this.p2pManager.getOutboundRateLimiter(transport);
            transport.send(serializedRpc, rateLimiter);
        });
    }
}

export default RpcHandler;
