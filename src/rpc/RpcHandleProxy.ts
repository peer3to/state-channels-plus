import ARpcMethods from "./ARpcMethods";
import ARpcService from "./ARpcService";
import Clock from "@/Clock";
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
export type RpcHandleMethods<T extends ARpcMethods> = {
    [K in keyof T as T[K] extends Function ? K : never]: RpcHandleMethod<T[K]>;
};

/**
 * Passed by reference so that the calling context can dynamically change it
 */
export type RpcMethodsContextObject = {
    serviceName: string;
    service: ARpcService<any>; // don't care for the type here -> so any
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
                    return (...args: unknown[]) => {
                        const timestamp = Clock.getTimeInSeconds();
                        const method = prop.toString();

                        return new RpcHandler(
                            {
                                service: ctx.serviceName,
                                method,
                                params: args,
                                timestamp
                            },
                            ctx.service.p2pManager
                        );
                    };
                }
            }
        ) as RpcHandleMethods<ReturnType<typeof ctx.service.createRPCMethods>>;
    }
}
export default RpcMethodsProxy;
