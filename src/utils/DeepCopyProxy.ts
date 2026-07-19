import cloneDeep from "lodash.clonedeep";

export function deepCopyProxy<T extends object>(original: T): T {
    return new Proxy(original, {
        get(target, prop) {
            const originalValue = Reflect.get(target, prop);

            // wrap functions/methods
            if (typeof originalValue === "function") {
                return function (...args: any[]) {
                    // Deep copy arguments
                    const copiedArgs = args.map(cloneDeep);

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
