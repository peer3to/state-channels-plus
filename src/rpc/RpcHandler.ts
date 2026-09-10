import Rpc from "./Rpc";
import type { RpcRequestOptions, RpcRouter } from "./RpcRouter";
import ATransport, { isTransport } from "../transport/ATransport";
import { Address } from "../types/types";

export type { RpcRequestOptions } from "./RpcRouter";

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
    router: RpcRouter<any, any>;
    constructor(rpc: Rpc, router: RpcRouter<any, any>) {
        this.rpc = rpc;
        this.router = router;
    }

    public broadcast() {
        this.router.broadcastRpc(this.rpc);
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
            const transport = this.router.resolveTransport(address);
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

        let transport: ATransport | undefined;
        try {
            transport = this.resolveTarget(target);
        } catch (e) {
            return Promise.reject(e as Error);
        }
        if (!transport) {
            return Promise.reject(
                new Error(
                    `RpcHandler.request: no open transport for target '${String(
                        target
                    )}'`
                )
            );
        }
        return this.router.sendRpcRequest<TResult>(
            this.rpc,
            transport,
            options
        );
    }

    /**
     * Resolves a delivery target to a transport. An omitted target delivers to
     * self via the in-process loopback transport, or - on a router that has
     * none - to its single line, which is the whole far end there.
     */
    private resolveTarget(
        target?: ATransport | Address
    ): ATransport | undefined {
        if (target === undefined) {
            if (this.router.loopbackTransport) {
                return this.router.loopbackTransport;
            }
            const [only] = this.router.transports;
            if (this.router.transports.size !== 1) {
                throw new Error(
                    `RpcHandler: '${this.rpc.service}.${this.rpc.method}' needs a target: this router has no loopback and ${this.router.transports.size} transports`
                );
            }
            return only;
        }
        if (isTransport(target)) return target;
        return this.router.resolveTransport(target);
    }
}

export default RpcHandler;
