import ARpcMethods from "./ARpcMethods";
import ARpcService from "./ARpcService";
import Clock from "@/Clock";
import Rpc, { createMessageContent } from "./Rpc";
import RpcHandler from "./RpcHandler";

/**
 * Transforms a function's return type into a RpcHandler
 */
type RpcHandleMethod<T> = T extends (...args: infer A) => any
    ? (...args: A) => Promise<RpcHandler>
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
                    return async (...args: any) => {
                        const timestamp = Clock.getTimeInSeconds();
                        const method = prop.toString();

                        // Create message content (what we want to sign)
                        const messageContent = createMessageContent(
                            method,
                            args,
                            timestamp
                        );

                        // Sign the message content using P2P signer
                        const signature =
                            await ctx.service.p2pManager.p2pSigner.signMessage(
                                messageContent
                            );

                        // Create the complete RPC structure
                        const rpc: Rpc = {
                            service: ctx.serviceName,
                            method: method,
                            params: args,
                            timestamp: timestamp,
                            signature: signature
                        };

                        return new RpcHandler(rpc, ctx.service.p2pManager);
                    };
                }
            }
        ) as RpcHandleMethods<ReturnType<typeof ctx.service.createRPCMethods>>;
    }
}
export default RpcMethodsProxy;
