import ARpcService from "./ARpcService";
import MainRpcService from "./MainRpcService";
import Rpc from "./Rpc";
import RpcHandler from "./RpcHandler";
import RpcMethodsProxy, {
    RpcHandleMethods,
    RpcMethodsContextObject
} from "./RpcHandleProxy";
import InitHandshakeRpcMethods from "./services/initHandshake/InitHandshakeRpcMethods";

/**
 * Substitue the type of every 'service' in MainRpcService to the type of the coresponding 'RpcMethods' class
 * E.g. initService: InitService -> initService : InitRpcMethods
 * Now we can use a simple interface: remoteProxy.initService.initHandshakre(...)
 */
export type RemoteRpcProxyType<T extends MainRpcService> = {
    [K in keyof T as T[K] extends ARpcService<any>
        ? K
        : never]: T[K] extends ARpcService<infer R>
        ? RpcHandleMethods<R>
        : never;
};

class RemoteRpcProxy {
    public static createProxy(mainRpcService: MainRpcService) {
        // const cache = new Map<PropertyKey, unknown>();
        const ctx = {
            serviceName: "",
            service: undefined
        };
        const rpcMethodsProxy = RpcMethodsProxy.createProxy(
            ctx as unknown as RpcMethodsContextObject
        );
        return new Proxy(mainRpcService, {
            get(target, prop, receiver) {
                const val = Reflect.get(target, prop, receiver);

                if (typeof val != "object" || !(val instanceof ARpcService)) {
                    throw new Error("RemoteRpcProxy can only access services");
                }
                // val is a service
                const serviceName = prop.toString();
                ctx.serviceName = serviceName;
                // @ts-ignore
                ctx.service = val;
                return {};
            }
        }) as unknown as RemoteRpcProxyType<MainRpcService>;
    }
}
export default RemoteRpcProxy;
