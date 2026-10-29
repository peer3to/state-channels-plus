import ANetworkRpcMethods from "./ANetworkRpcMethods";
import { createRpcMethodProxy } from "../createRpcProxy";
import RpcHandler, {
    FireAndForgetRpcHandler,
    RequestRpcHandler
} from "./RpcHandler";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";

/**
 * Picks the delivery API based on a method's return type:
 * - `void`/`Promise<void>` -> fire-and-forget (broadcast/sendOne/sendMultiple)
 * - any other value        -> request/response (`request(target)` returning that value)
 */
type RpcCallHandler<R> = [Awaited<R>] extends [void]
    ? FireAndForgetRpcHandler
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
export type RpcHandleMethods<T extends ANetworkRpcMethods> = {
    [K in keyof T as T[K] extends (...args: any[]) => unknown
        ? K
        : never]: RpcHandleMethod<T[K]>;
};

/**
 * Passed by reference so that the calling context can dynamically change it
 */
export type RpcMethodsContextObject = {
    serviceName: string;
    service: ANetworkRpcService<any>; // don't care for the type here -> so any
};
class RpcMethodsProxy {
    public static createProxy(ctx: RpcMethodsContextObject) {
        return createRpcMethodProxy(
            () => ctx.serviceName,
            (rpc) => new RpcHandler(rpc, ctx.service.p2pManager)
        ) as RpcHandleMethods<ReturnType<typeof ctx.service.createRPCMethods>>;
    }
}
export default RpcMethodsProxy;
