import ARpcMethods from "./ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { RpcRouterLike } from "./ARpcRouter";
import Rpc from "./Rpc";
import RpcHandler, {
    FireAndForgetRpcHandler,
    RequestRpcHandler
} from "./RpcHandler";

/**
 * Picks the delivery API based on a method's return type:
 * - `void`          -> fire-and-forget (broadcast/sendOne/sendMultiple)
 * - `Promise<void>` -> both: nothing comes back, but "done" can be awaited
 * - any other value -> request/response (`request(target)` returning that value)
 */
type RpcCallHandler<R> = [R] extends [void]
    ? FireAndForgetRpcHandler
    : [Awaited<R>] extends [void]
      ? FireAndForgetRpcHandler & RequestRpcHandler<void>
      : RequestRpcHandler<Awaited<R>>;

/**
 * Transforms a function's return type into the matching RPC delivery handler
 */
type RpcHandleMethod<T> = T extends (...args: infer A) => infer R
    ? (...args: A) => RpcCallHandler<R>
    : T;

/**
 * Transforms all function/method return types into RpcHandlers
 */
export type RpcHandleMethods<T extends ARpcMethods> = {
    [K in keyof T as T[K] extends (...args: any[]) => unknown
        ? K
        : never]: RpcHandleMethod<T[K]>;
};

/**
 * Passed by reference so that the calling context can dynamically change it
 */
export type RpcMethodsContextObject = {
    serviceName: string;
    router: RpcRouterLike;
    /** set for an endpoint bound to one far transport */
    defaultTarget?: ATransport;
};
class RpcMethodsProxy {
    public static createProxy(ctx: RpcMethodsContextObject) {
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
                        const rpc: Rpc = {
                            service: ctx.serviceName,
                            method: prop.toString(),
                            params: args
                        };
                        return new RpcHandler(
                            rpc,
                            ctx.router,
                            ctx.defaultTarget
                        );
                    };
                }
            }
        ) as RpcHandleMethods<ARpcMethods<any>>;
    }
}
export default RpcMethodsProxy;
