import RpcMethodsProxy, { RpcHandleMethods } from "./RpcHandleProxy";
import type { RpcRouter } from "./RpcRouter";
import type ARpcService from "@/rpc/ARpcService";

/** every service on a root, seen as its delivery handles */
export type RemoteRpcServices<T extends object> = {
    [K in keyof T as T[K] extends ARpcService<any, any>
        ? K
        : never]: T[K] extends ARpcService<infer R, any>
        ? RpcHandleMethods<R>
        : never;
};

/**
 * the far end of this router's lines, typed by the root it serves. the far
 * root is never instantiated here: `TRemote` names its services and every
 * property is a handle for the service of that name.
 */
export function createRemoteRpcProxy<TRemote extends object>(
    router: RpcRouter<any, any>
): RemoteRpcServices<TRemote> {
    const proxyCache = new Map<
        string,
        ReturnType<typeof RpcMethodsProxy.createProxy>
    >();

    return new Proxy(
        {},
        {
            get(_target, prop) {
                // Avoid breaking common JS runtime inspection paths.
                if (typeof prop === "symbol") return undefined;
                if (prop === "then") return undefined;

                const serviceName = prop.toString();
                if (!proxyCache.has(serviceName)) {
                    proxyCache.set(
                        serviceName,
                        RpcMethodsProxy.createProxy({ serviceName, router })
                    );
                }
                return proxyCache.get(serviceName)!;
            }
        }
    ) as RemoteRpcServices<TRemote>;
}

export default createRemoteRpcProxy;
