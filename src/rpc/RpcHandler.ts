import ATransport, { isTransport } from "../transport/ATransport";
import { Address } from "../types/types";
import type { RpcRequestOptions, RpcRouterLike } from "./ARpcRouter";
import Rpc from "./Rpc";

export type { RpcRequestOptions } from "./ARpcRouter";

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
    router: RpcRouterLike;
    /** where an omitted target goes: the far end of a bound endpoint */
    private readonly defaultTarget?: ATransport;
    constructor(rpc: Rpc, router: RpcRouterLike, defaultTarget?: ATransport) {
        this.rpc = rpc;
        this.router = router;
        this.defaultTarget = defaultTarget;
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
        return this.router.sendRpcRequest<TResult>(
            this.rpc,
            transport,
            options
        );
    }

    /**
     * Resolves a delivery target to a transport. An omitted target delivers to
     * the bound far end of an endpoint, else to self via the in-process
     * loopback transport.
     */
    private resolveTarget(
        target?: ATransport | Address
    ): ATransport | undefined {
        if (target === undefined) {
            return this.defaultTarget ?? this.router.loopbackTransport;
        }
        if (isTransport(target)) return target;
        return this.router.resolveTransport(target);
    }
}

export default RpcHandler;
