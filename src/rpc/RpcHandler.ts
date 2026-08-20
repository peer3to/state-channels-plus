import type P2PManager from "../P2PManager";
import ATransport, { isTransport } from "../transport/ATransport";
import { Address } from "../types/types";
import Rpc from "./Rpc";

export type RpcRequestOptions = { timeoutMs?: number };

/**
 * Type face exposed for RPC methods that return `void`/`Promise<void>`.
 * Fire-and-forget delivery only — no reply is expected. Omitting the target on
 * `sendOne` delivers to self (loopback).
 */
export interface FireAndForgetRpcHandler {
    broadcast(): void;
    sendOne(): void;
    sendOne(transport: ATransport): void;
    sendOne(address: Address): void;
    sendMultiple(transports: ATransport[]): void;
    sendMultiple(addresses: Address[]): void;
}

/**
 * Type face exposed for RPC methods that return a value. Only request/response
 * delivery is offered, resolving with the peer handler's return value. Omitting
 * the target runs the method on self (loopback).
 */
export interface RequestRpcHandler<TResult> {
    request(options?: RpcRequestOptions): Promise<TResult>;
    request(
        target: ATransport | Address,
        options?: RpcRequestOptions
    ): Promise<TResult>;
}

class RpcHandler {
    rpc: Rpc;
    p2pManager: P2PManager;
    constructor(rpc: Rpc, p2pManager: P2PManager) {
        this.rpc = rpc;
        this.p2pManager = p2pManager;
    }

    public broadcast() {
        this.p2pManager.broadcastRpc(this.rpc);
    }

    public sendOne(): void;
    public sendOne(transport: ATransport): void;
    public sendOne(address: Address): void;
    public sendOne(target?: ATransport | Address) {
        const transport = this.resolveTarget(target);
        if (!transport) return;
        transport.send(this.rpc);
    }

    public sendMultiple(transports: ATransport[]): void;
    public sendMultiple(addresses: Address[]): void;
    public sendMultiple(targets: ATransport[] | Address[]) {
        if (targets.length === 0) return;

        if (isTransport(targets[0])) {
            (targets as ATransport[]).forEach((transport) => {
                transport.send(this.rpc);
            });
            return;
        }

        (targets as Address[]).forEach((address) => {
            const transport =
                this.p2pManager.profileManager.getTransportByEvmAddress(
                    address
                );
            if (!transport) return;
            transport.send(this.rpc);
        });
    }

    public request<TResult = unknown>(
        options?: RpcRequestOptions
    ): Promise<TResult>;
    public request<TResult = unknown>(
        target: ATransport | Address,
        options?: RpcRequestOptions
    ): Promise<TResult>;
    public request<TResult = unknown>(
        targetOrOptions?: ATransport | Address | RpcRequestOptions,
        maybeOptions?: RpcRequestOptions
    ): Promise<TResult> {
        const targetOmitted =
            targetOrOptions === undefined ||
            (!isTransport(targetOrOptions) &&
                typeof targetOrOptions === "object");
        const target = targetOmitted
            ? undefined
            : (targetOrOptions as ATransport | Address);
        const options = targetOmitted
            ? (targetOrOptions as RpcRequestOptions | undefined)
            : maybeOptions;

        const transport = this.resolveTarget(target);
        if (!transport) {
            return Promise.reject(
                new Error(
                    `RpcHandler.request: no open transport for target '${String(
                        target
                    )}'`
                )
            );
        }
        return this.p2pManager.sendRpcRequest<TResult>(
            this.rpc,
            transport,
            options
        );
    }

    /**
     * Resolves a delivery target to a transport. An omitted target delivers to
     * self via the in-process loopback transport.
     */
    private resolveTarget(
        target?: ATransport | Address
    ): ATransport | undefined {
        if (target === undefined) return this.p2pManager.loopbackTransport;
        if (isTransport(target)) return target;
        return (
            this.p2pManager.profileManager.getTransportByEvmAddress(target) ??
            undefined
        );
    }
}

export default RpcHandler;
