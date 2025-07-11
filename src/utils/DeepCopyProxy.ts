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

                    // Deep copy result
                    return cloneDeep(result);
                };
            }

            // not a function, return as-is
            return originalValue;
        }
    });
}
