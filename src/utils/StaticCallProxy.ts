import { ethers } from "ethers";
import { Codec } from "./Codec";

function convertResultRecursive(value: any): any {
    // Check if it's an ethers Result object
    if (
        value instanceof ethers.Result &&
        Object.getPrototypeOf(value) === ethers.Result.prototype
    ) {
        return Codec.convertEthersResultToObject(value);
    }

    if (Array.isArray(value)) {
        return value.map(convertResultRecursive);
    }

    // If it's an object (but not a Result), recursively convert properties
    if (value && typeof value === "object" && value.constructor === Object) {
        const converted: Record<string, any> = {};
        for (const key in value) {
            converted[key] = convertResultRecursive(value[key]);
        }
        return converted;
    }

    // Primitive value, return as-is
    return value;
}

export function createStaticCallProxy<T>(contract: T): T {
    return new Proxy(contract as object, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);

            // If it's a function with staticCall, create a wrapper function
            if (
                original &&
                typeof original === "function" &&
                typeof original.staticCall === "function"
            ) {
                // Create wrapper function that behaves like the original
                const wrapper = (...args: any[]) => original(...args);

                // Copy all property descriptors except staticCall to the wrapper
                const descriptors = Object.getOwnPropertyDescriptors(original);
                delete descriptors.staticCall;
                Object.defineProperties(wrapper, descriptors);

                // Define staticCall method that converts results
                Object.defineProperty(wrapper, "staticCall", {
                    value: (...args: any[]) =>
                        original
                            .staticCall(...args)
                            .then(convertResultRecursive),
                    writable: true,
                    enumerable: true,
                    configurable: true
                });

                return wrapper;
            }

            // Non-function properties return as-is
            return original;
        }
    }) as T;
}
