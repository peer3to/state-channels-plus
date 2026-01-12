/**
 * Type guard to check if an object has a certain property.
 */
export function hasProperty<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, unknown> {
    return typeof obj === "object" && obj !== null && prop in obj;
}

/**
 * Type guard to check if an object has a certain method.
 */
export function hasMethod<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, (...params: any[]) => any> {
    return hasProperty(obj, prop) && typeof obj[prop] === "function";
}

/**
 * Type guard to check if an object has a certain method.
 */
export function isInstanceOfRpcService<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, (...params: any[]) => any> {
    return (
        hasProperty(obj, prop) &&
        typeof obj[prop] === "object" &&
        obj[prop] !== null &&
        // Avoid importing ARpcService at runtime (prevents circular deps in browser bundles).
        // Structural check is sufficient for our usage.
        typeof (obj as any)[prop]?.runRPC === "function"
    );
}
