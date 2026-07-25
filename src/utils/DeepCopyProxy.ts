import cloneDeep from "lodash.clonedeep";

import { OPAQUE_CLONE } from "@/storage/persistence/PersistencePort";

// A top-level arg carrying OPAQUE_CLONE (e.g. a PersistencePort) holds live
// handles a structural clone would corrupt - pass it through by reference.
function isOpaque(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<symbol, unknown>)[OPAQUE_CLONE] === true
    );
}

export function deepCopyProxy<T extends object>(original: T): T {
    return new Proxy(original, {
        get(target, prop) {
            const originalValue = Reflect.get(target, prop);

            // wrap functions/methods
            if (typeof originalValue === "function") {
                return function (...args: any[]) {
                    // Deep copy arguments (opaque args pass through uncloned).
                    const copiedArgs = args.map((arg) =>
                        isOpaque(arg) ? arg : cloneDeep(arg)
                    );

                    // Call original method
                    const result = originalValue.apply(target, copiedArgs);

                    // Don't deep copy generators - return them as-is
                    if (
                        result &&
                        typeof result === "object" &&
                        typeof result.next === "function"
                    ) {
                        return result;
                    }

                    // Don't deep copy promises - cloneDeep has no special case for
                    // them and strips the internal slots .then() needs.
                    if (result instanceof Promise) {
                        return result;
                    }

                    // Deep copy other results
                    return cloneDeep(result);
                };
            }

            // not a function, return as-is
            return originalValue;
        }
    });
}
