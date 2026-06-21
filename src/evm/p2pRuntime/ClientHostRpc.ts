import type MainRpcService from "@/rpc/MainRpcService";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import type { RuntimeRequester } from "./types";

/**
 * Builds the client-side `hostRpc` proxy. It mirrors the host's `remoteRpc`
 * surface exactly ({@link RemoteRpcProxyType}); the runtime port is a pure
 * proxy. A call such as `hostRpc.svc.m(...params).request(addr?, opts?)` is
 * forwarded verbatim and the host replays the identical chained call on its own
 * `remoteRpc`, awaiting and returning the result for `request`.
 *
 * As on the host, an omitted delivery target runs the method on the host itself
 * (loopback); a peer address relays it. Only addresses can be used as targets
 * from the client (transports are not serializable across the port).
 */
export function createHostRpc<TCustomRpc extends MainRpcService>(
    requester: RuntimeRequester
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
                        createServiceProxy(requester, service)
                    );
                }
                return serviceCache.get(service);
            }
        }
    );

    return root as unknown as RemoteRpcProxyType<TCustomRpc>;
}

function createServiceProxy(requester: RuntimeRequester, service: string) {
    return new Proxy(
        {},
        {
            get(_target, methodProp) {
                if (typeof methodProp === "symbol") return undefined;
                const method = methodProp.toString();
                return (...params: unknown[]) =>
                    createDeliveryHandle(requester, service, method, params);
            }
        }
    );
}

function createDeliveryHandle(
    requester: RuntimeRequester,
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
                    requester.request({
                        type: "hostRpc",
                        service,
                        method,
                        params,
                        delivery,
                        args
                    });
            }
        }
    );
}
