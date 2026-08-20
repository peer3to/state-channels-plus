// @spec-test-coverage-ignore: worker-side support methods for the mapped RpcHandler integration cases
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { Address } from "@/types";
import type { PingPongRpc, SumResponse } from "../PingPongRpcManifest";
import type { RpcResponse } from "@/rpc/Rpc";
import type { RpcHandlerProbeService } from "./RpcHandlerProbeService";

export class RpcHandlerProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: RpcHandlerProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public broadcastRecord(nonce: string): boolean {
        this.remoteRpc.pingService.recordPing(nonce).broadcast();
        return true;
    }

    public sendOneByCompatibleTransport(
        nonce: string,
        address: Address
    ): boolean {
        this.remoteRpc.pingService
            .recordPing(nonce)
            .sendOne(this.service.getCompatibleTransport(address));
        return true;
    }

    public sendOneLoopback(nonce: string): boolean {
        this.remoteRpc.pingService.recordPing(nonce).sendOne();
        return true;
    }

    public sendOneByAddress(nonce: string, address: Address): boolean {
        this.remoteRpc.pingService.recordPing(nonce).sendOne(address);
        return true;
    }

    public sendMultipleByTransports(
        nonce: string,
        addresses: Address[]
    ): boolean {
        this.remoteRpc.pingService
            .recordPing(nonce)
            .sendMultiple(
                addresses.map((address) => this.service.getTransport(address))
            );
        return true;
    }

    public sendMultipleByAddresses(
        nonce: string,
        addresses: Address[]
    ): boolean {
        this.remoteRpc.pingService.recordPing(nonce).sendMultiple(addresses);
        return true;
    }

    public sendMultipleEmpty(nonce: string): boolean {
        this.remoteRpc.pingService.recordPing(nonce).sendMultiple([]);
        return true;
    }

    public requestSumByCompatibleTransport(
        a: number,
        b: number,
        nonce: string,
        address: Address
    ): Promise<SumResponse> {
        return this.remoteRpc.pingService
            .sum(a, b, nonce)
            .request(this.service.getCompatibleTransport(address));
    }

    public requestMissingAddress(address: Address): Promise<SumResponse> {
        return this.remoteRpc.pingService
            .sum(1, 2, "missing-address")
            .request(address);
    }

    public requestLoopbackTimeout(timeoutMs: number): Promise<string> {
        return this.remoteRpc.pingService.never().request({ timeoutMs });
    }

    public sendRawRpc(
        address: Address,
        service: string,
        method: string
    ): boolean {
        this.service.sendRawRpc(address, service, method);
        return true;
    }

    public sendEmptyIdRequestAndCaptureResponse(
        address: Address
    ): Promise<RpcResponse> {
        return this.service.sendEmptyIdRequestAndCaptureResponse(address);
    }

    public sendMultibyteOversizedRpc(address: Address): boolean {
        this.service.sendMultibyteOversizedRpc(address);
        return true;
    }
}
