import type { RpcServiceContract } from "@/rpc/RpcDispatch";
import type { Result } from "ethers";

/**
 * Prototype-aware property check for public structural contracts.
 * This does not authorize remotely callable RPC endpoints.
 */
export function hasProperty<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, unknown> {
    return typeof obj === "object" && obj !== null && prop in obj;
}

/**
 * Prototype-aware method check for public structural contracts.
 * This does not authorize remotely callable RPC endpoints.
 */
export function hasMethod<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, (...params: any[]) => any> {
    return hasProperty(obj, prop) && typeof obj[prop] === "function";
}

/**
 * Type guard for the complete public RPC-service shape loaded from any
 * JavaScript module graph.
 */
export function hasRpcService<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, RpcServiceContract> {
    return (
        hasProperty(obj, prop) &&
        typeof obj[prop] === "object" &&
        obj[prop] !== null &&
        hasMethod(obj[prop], "createRPCMethods") &&
        hasProperty(obj[prop], "router") &&
        typeof obj[prop].router === "object" &&
        obj[prop].router !== null &&
        hasMethod(obj[prop], "runRPC")
    );
}

/**
 * Type guard for the public ethers Result shape loaded from any JavaScript
 * module graph.
 */
export function isEthersResult(value: unknown): value is Result {
    return (
        Array.isArray(value) &&
        hasMethod(value, "getValue") &&
        hasMethod(value, "toArray") &&
        hasMethod(value, "toObject")
    );
}
