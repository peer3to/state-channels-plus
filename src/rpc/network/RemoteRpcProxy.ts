import { createRpcProxy } from "../createRpcProxy";
import type { RpcHandleMethods } from "./RpcHandleProxy";
import RpcHandler from "./RpcHandler";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type MainRpcService from "@/rpc/network/MainRpcService";
import { hasRpcService } from "@/utils/ObjectChecks";

type RemoteRpcServices<T extends object> = {
    [K in keyof T as T[K] extends ANetworkRpcService<any, any>
        ? K
        : never]: T[K] extends ANetworkRpcService<infer R, any>
        ? RpcHandleMethods<R>
        : never;
};

/**
 * Substitue the type of every 'service' in MainRpcService to the type of the coresponding 'RpcMethods' class
 * E.g. initService: InitService -> initService : InitRpcMethods
 * Now we can use a simple interface: remoteProxy.initService.initHandshakre(...)
 */
export type RemoteRpcProxyType<T extends object> =
    RemoteRpcServices<MainRpcService> & RemoteRpcServices<T>;

class RemoteRpcProxy {
    public static createProxy<TLocalRpcRoot extends object>(
        localRpcRoot: TLocalRpcRoot
    ): RemoteRpcProxyType<TLocalRpcRoot> {
        return createRpcProxy(
            (rpc) => {
                const service = Reflect.get(
                    localRpcRoot,
                    rpc.service
                ) as ANetworkRpcService<any>;
                return new RpcHandler(rpc, service.p2pManager);
            },
            localRpcRoot,
            (service) => {
                if (!hasRpcService(localRpcRoot, service)) {
                    throw new Error("RemoteRpcProxy can only access services");
                }
            }
        ) as RemoteRpcProxyType<TLocalRpcRoot>;
    }
}
export default RemoteRpcProxy;
