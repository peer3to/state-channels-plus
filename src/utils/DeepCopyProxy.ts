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

                    // Keep generators lazy - deep copy each value as it is yielded
                    if (
                        result &&
                        typeof result === "object" &&
                        typeof result.next === "function"
                    ) {
                        return copyYieldedValues(result);
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

// closing the copy (break, return, throw) closes the wrapped generator too
function* copyYieldedValues<TValue>(
    generator: Iterable<TValue>
): Generator<TValue, void, unknown> {
    for (const value of generator) {
        yield cloneDeep(value);
    }
}
