import ARpcService from "@/rpc/ARpcService";
import RpcMethodsProxy, { RpcHandleMethods } from "./RpcHandleProxy";

/**
 * Substitue the type of every 'service' in MainRpcService to the type of the coresponding 'RpcMethods' class
 * E.g. initService: InitService -> initService : InitRpcMethods
 * Now we can use a simple interface: remoteProxy.initService.initHandshakre(...)
 */
export type RemoteRpcProxyType<T extends object> = {
    [K in keyof T as T[K] extends ARpcService<any, any>
        ? K
        : never]: T[K] extends ARpcService<infer R, any>
        ? RpcHandleMethods<R>
        : never;
};

class RemoteRpcProxy {
    public static createProxy<TLocalRpcRoot extends object>(
        localRpcRoot: TLocalRpcRoot
    ): RemoteRpcProxyType<TLocalRpcRoot> {
        const proxyCache = new Map<
            string,
            ReturnType<typeof RpcMethodsProxy.createProxy>
        >();

        return new Proxy(localRpcRoot, {
            get(target, prop, receiver) {
                // Avoid breaking common JS runtime inspection paths.
                if (typeof prop === "symbol") {
                    return Reflect.get(target, prop, receiver);
                }
                if (prop === "then") {
                    return undefined;
                }

                const val = Reflect.get(target, prop, receiver);

                if (typeof val != "object" || !(val instanceof ARpcService)) {
                    throw new Error("RemoteRpcProxy can only access services");
                }

                // val is a service
                const serviceName = prop.toString();

                // Create and cache proxy per service
                if (!proxyCache.has(serviceName)) {
                    const ctx = {
                        serviceName,
                        service: val
                    };
                    proxyCache.set(
                        serviceName,
                        RpcMethodsProxy.createProxy(ctx)
                    );
                }

                return proxyCache.get(serviceName)!;
            }
        }) as unknown as RemoteRpcProxyType<TLocalRpcRoot>;
    }
}
export default RemoteRpcProxy;
