import MainRpcService from "./MainRpcService";
import Rpc from "./Rpc";
import RpcHandler from "./RpcHandler";

/**
 * Transforms a function's return type into a RpcHandler
 */
type RpcHandleMethod<T> = T extends (...args: infer A) => any
    ? (...args: A) => RpcHandler
    : T;

/**
 * Transforms all function/method return types into RpcHandlers
 */
export type RpcHandleMethods<T extends MainRpcService> = {
    [K in keyof T]: RpcHandleMethod<T[K]>;
};

class RpcProxy {
    public static createProxy<T extends MainRpcService>(service: T) {
        return new Proxy(
            {},
            {
                get(target, prop, receiver) {
                    //Target is {} - this won't trigger
                    if (Reflect.has(target, prop)) {
                        return Reflect.get(target, prop, receiver);
                    }
                    if (typeof prop === "symbol") return;
                    return (...args: any) => {
                        let rpc: Rpc = {
                            method: prop.toString(),
                            params: args
                        };
                        return new RpcHandler(rpc, service.p2pManager);
                    };
                }
            }
        ) as RpcHandleMethods<T>;
    }
}
export default RpcProxy;
