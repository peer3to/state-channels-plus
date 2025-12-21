import type ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";

/**
 * Factory-map for registering additional RPC services.
 *
 * Keys become service names on both:
 * - `p2pManager.localRpc.<serviceName>` (service instance)
 * - `p2pManager.remoteRpc.<serviceName>` (methods-only remote proxy)
 */
export type RpcServiceFactoryMap = {
    [serviceName: string]: RpcServiceFactory | undefined;
};

/**
 * Intentionally loose factory signature.
 *
 * For strong typing (literal keys + correctly typed `p2pManager`), prefer
 * `defineRpcServices(...)`.
 */
export type RpcServiceFactory = (p2pManager: any) => ARpcService<any, any>;

export type RpcServiceInstances<TFactories> = {
    [K in keyof TFactories as K extends string
        ? K
        : never]: TFactories[K] extends (...args: any[]) => infer R ? R : never;
};

/**
 * Identity helper to preserve literal keys for type inference.
 *
 * - Preserves keys (so `pingService` becomes a real property)
 * - Contextually types each factory's argument as `P2PManager<TFactories>`
 * - Preserves each factory's inferred return type
 */
export function defineRpcServices<
    const TFactories extends RpcServiceFactoryMap
>(
    factories: TFactories & {
        [K in keyof TFactories]: (p2pManager: P2PManager<TFactories>) => any;
    }
): TFactories {
    return factories;
}
