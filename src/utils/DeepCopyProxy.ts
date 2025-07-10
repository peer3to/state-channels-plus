import cloneDeep from "lodash.clonedeep";

export function createDeepCopyProxy<T extends object>(original: T): T {
    return new Proxy(original, {
        get(target, prop) {
            const originalValue = Reflect.get(target, prop);

            // wrap functions/methods
            if (typeof originalValue === "function") {
                return function (...args: any[]) {
                    // Deep copy arguments
                    const copiedArgs = args.map((arg) => cloneDeep(arg));

                    // Call original method
                    const result = originalValue.apply(target, copiedArgs);

                    // Deep copy result
                    return cloneDeep(result);
                };
            }
            // For class instances , apply recursive proxy
            if (isClassInstance(originalValue)) {
                return createDeepCopyProxy(originalValue as T);
            }

            // not a funciton and not a class instance, return as-is
            return originalValue;
        }
    });
}

const isClassInstance = (value: any): boolean => {
    return (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) && // Not an array
        Object.getPrototypeOf(value) !== Object.prototype
    ); // Not plain object
};
