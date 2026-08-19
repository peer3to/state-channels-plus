import type { Result } from "ethers";
import type ARpcService from "@/rpc/ARpcService";

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
): obj is T & Record<P, ARpcService<any>> {
    return (
        hasProperty(obj, prop) &&
        typeof obj[prop] === "object" &&
        obj[prop] !== null &&
        hasMethod(obj[prop], "createRPCMethods") &&
        hasProperty(obj[prop], "p2pManager") &&
        typeof obj[prop].p2pManager === "object" &&
        obj[prop].p2pManager !== null &&
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
