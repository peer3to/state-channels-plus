// @spec-test-coverage-ignore: worker-side support service for the mapped RpcHandler integration cases
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { isTransport } from "@/transport/ATransport";
import type { Address } from "@/types";
import ARpcService from "@/rpc/ARpcService";
import type { RpcResponse } from "@/rpc/Rpc";
import { deserializeRpcResponse, MAX_RPC_FRAME_BYTES } from "@/rpc/Rpc";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { RpcHandlerProbeRpcMethods } from "./RpcHandlerProbeRpcMethods";

export class RpcHandlerProbeService extends ARpcService<
    RpcHandlerProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "RpcHandlerProbeService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): RpcHandlerProbeRpcMethods {
        return new RpcHandlerProbeRpcMethods(transport, this);
    }

    public getTransport(address: Address): ATransport {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(address);
        if (!transport) {
            throw new Error(`No open transport toward peer ${address}`);
        }
        return transport;
    }

    public getCompatibleTransport(address: Address): ATransport {
        const transport = this.getTransport(address);
        const compatibleTransport: unknown = {
            transportType: transport.transportType,
            peerAddress: transport.peerAddress,
            send: transport.send.bind(transport),
            sendRpcResponse: transport.sendRpcResponse.bind(transport)
        };
        if (!isTransport(compatibleTransport)) {
            throw new Error(
                "Compatible transport does not satisfy its contract"
            );
        }
        return compatibleTransport;
    }

    public sendRawRpc(address: Address, service: string, method: string): void {
        this.getTransport(address).send({ service, method, params: [] });
    }

    public async sendEmptyIdRequestAndCaptureResponse(
        address: Address
    ): Promise<RpcResponse> {
        const transport = this.getTransport(address);
        const originalOnRpc = this.p2pManager.onRpc;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = new Promise<RpcResponse>((resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("Empty-id response timed out")),
                    2000
                );
                this.p2pManager.onRpc = (
                    serializedRpc: string,
                    senderTransport: ATransport
                ): void => {
                    const decoded = deserializeRpcResponse(serializedRpc);
                    if (decoded?.requestId === "") resolve(decoded);
                    Reflect.apply(originalOnRpc, this.p2pManager, [
                        serializedRpc,
                        senderTransport
                    ]);
                };
            });
            transport.send({
                service: "pingService",
                method: "sum",
                params: [1, 2, "empty-id-e2e"],
                requestId: ""
            });
            return await response;
        } finally {
            if (timeout) clearTimeout(timeout);
            this.p2pManager.onRpc = originalOnRpc;
        }
    }

    public sendMultibyteOversizedRpc(address: Address): void {
        this.getTransport(address).send({
            service: "pingService",
            method: "recordPing",
            params: ["é".repeat(Math.ceil(MAX_RPC_FRAME_BYTES / 2))]
        });
    }
}
