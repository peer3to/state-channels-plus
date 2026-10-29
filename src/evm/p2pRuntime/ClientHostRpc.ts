import type { P2pRuntimeHostRoot } from "../../rpc/internal/roots/P2pRuntimeHostRoot";
import { createRpcProxy } from "@/rpc/createRpcProxy";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import type MainRpcService from "@/rpc/network/MainRpcService";
import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";

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
    requester: RuntimeConnection<P2pRuntimeHostRoot>
): RemoteRpcProxyType<TCustomRpc> {
    return createRpcProxy((rpc) =>
        createDeliveryHandle(requester, rpc.service, rpc.method, rpc.params)
    ) as RemoteRpcProxyType<TCustomRpc>;
}

function createDeliveryHandle(
    requester: RuntimeConnection<P2pRuntimeHostRoot>,
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
                    requester.hostRpc
                        .invoke(service, method, params, delivery, args)
                        .request();
            }
        }
    );
}
