import type MainRpcService from "@/rpc/MainRpcService";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import type { RuntimeHostEndpoint } from "./P2pRuntimeClient";

/**
 * Builds the client-side `hostRpc` proxy. It mirrors the host's `remoteRpc`
 * surface exactly ({@link RemoteRpcProxyType}); the runtime port is a pure
 * proxy. A call such as `hostRpc.svc.m(...params).request(addr?, opts?)` is
 * forwarded verbatim through the host's `hostRpc.call` service and the host
 * replays the identical chained call on its own `remoteRpc`, awaiting and
 * returning the result for `request`.
 *
 * As on the host, an omitted delivery target runs the method on the host itself
 * (loopback); a peer address relays it. Only addresses can be used as targets
 * from the client (transports are not serializable across the port).
 */
export function createHostRpc<TCustomRpc extends MainRpcService>(
    host: RuntimeHostEndpoint
): RemoteRpcProxyType<TCustomRpc> {
    const serviceCache = new Map<string, unknown>();

    const root = new Proxy(
        {},
        {
            get(_target, serviceProp) {
                if (typeof serviceProp === "symbol") return undefined;
                const service = serviceProp.toString();
                if (!serviceCache.has(service)) {
                    serviceCache.set(
                        service,
                        createServiceProxy(host, service)
                    );
                }
                return serviceCache.get(service);
            }
        }
    );

    return root as unknown as RemoteRpcProxyType<TCustomRpc>;
}

function createServiceProxy(host: RuntimeHostEndpoint, service: string) {
    return new Proxy(
        {},
        {
            get(_target, methodProp) {
                if (typeof methodProp === "symbol") return undefined;
                const method = methodProp.toString();
                return (...params: unknown[]) =>
                    createDeliveryHandle(host, service, method, params);
            }
        }
    );
}

function createDeliveryHandle(
    host: RuntimeHostEndpoint,
    service: string,
    method: string,
    params: unknown[]
) {
    // Capture whatever delivery method (request/sendOne/broadcast/...) and args
    // the caller uses and forward them verbatim. The host replays the identical
    // chained call, so new RpcHandler methods work here with no changes.
    return new Proxy(
        {},
        {
            get(_target, deliveryProp) {
                if (typeof deliveryProp === "symbol") return undefined;
                const delivery = deliveryProp.toString();
                return (...args: unknown[]) =>
                    host.hostRpc
                        .call(service, method, params, delivery, args)
                        .request();
            }
        }
    );
}
