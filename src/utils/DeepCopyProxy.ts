import cloneDeep from "lodash.clonedeep";

export function deepCopyProxy<T extends object>(
    original: T,
    options?: { preserveArgumentsFor?: ReadonlySet<PropertyKey> }
): T {
    return new Proxy(original, {
        get(target, prop) {
            const originalValue = Reflect.get(target, prop);

            // wrap functions/methods
            if (typeof originalValue === "function") {
                return function (...args: any[]) {
                    // Deep copy arguments
                    const copiedArgs = options?.preserveArgumentsFor?.has(prop)
                        ? args
                        : args.map(cloneDeep);

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

                    if (result instanceof Promise) {
                        return result.then((value) => cloneDeep(value));
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
