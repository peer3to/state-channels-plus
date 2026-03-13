import { ethers } from "ethers";
import { Codec } from "./Codec";

type Listener = (...args: any[]) => unknown;

function isListener(value: unknown): value is Listener {
    return typeof value === "function";
}

function isEthersResult(value: unknown): value is ethers.Result {
    return (
        value instanceof ethers.Result &&
        Object.getPrototypeOf(value) === ethers.Result.prototype
    );
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
    return (
        !!value &&
        (typeof value === "object" || typeof value === "function") &&
        typeof (value as Promise<T>).then === "function"
    );
}

function isPlainObject(value: unknown): value is Record<string, any> {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function convertValue(value: any): any {
    if (isEthersResult(value)) {
        return Codec.convertEthersResultToObject(value);
    }

    if (Array.isArray(value)) {
        let mutated = false;
        const converted = value.map((item) => {
            const next = convertValue(item);
            if (next !== item) {
                mutated = true;
            }
            return next;
        });
        return mutated ? converted : value;
    }

    if (isPlainObject(value)) {
        let mutated = false;
        const converted: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            const next = convertValue(value[key]);
            if (next !== value[key]) {
                mutated = true;
            }
            converted[key] = next;
        }
        return mutated ? converted : value;
    }

    return value;
}

function convertReturn<T>(result: T): T {
    if (isPromiseLike(result)) {
        return result.then((resolved) => convertValue(resolved)) as T;
    }
    return convertValue(result);
}
// Make args mutable, so ethers doesn't throw
function convertArgs(args: any[]): any[] {
    let mutated = false;
    const converted = args.map((arg) => {
        const next = convertValue(arg);
        if (next !== arg) {
            mutated = true;
        }
        return next;
    });

    return mutated ? converted : args;
}

function convertEventLog(log: any): any {
    if (log && typeof log === "object" && "args" in log) {
        const convertedArgs = convertValue(log.args);
        if (convertedArgs !== log.args) {
            const clonedLog = Object.create(Object.getPrototypeOf(log));
            return Object.assign(clonedLog, log, { args: convertedArgs });
        }
    }
    return convertValue(log);
}

function wrapContractMethod(original: any, target: any) {
    const wrapper = (...args: any[]) =>
        convertReturn(original.apply(target, convertArgs(args)));

    const descriptors = Object.getOwnPropertyDescriptors(original);
    delete descriptors.staticCall;
    Object.defineProperties(wrapper, descriptors);

    Object.defineProperty(wrapper, "staticCall", {
        value: (...args: any[]) =>
            convertReturn(original.staticCall.apply(target, convertArgs(args))),
        writable: true,
        enumerable: true,
        configurable: true
    });

    return wrapper;
}

export function createEthersResultProxy<T>(contract: T): T {
    const listenerMap = new WeakMap<Listener, Listener>();

    const getWrappedListener = (listener: Listener) => {
        if (listenerMap.has(listener)) {
            return listenerMap.get(listener)!;
        }

        const wrapped = (...args: any[]) => {
            const convertedArgs = args.map((arg) => convertEventLog(arg));
            return listener(...convertedArgs);
        };
        listenerMap.set(listener, wrapped);
        return wrapped;
    };

    return new Proxy(contract as object, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);

            // Wrap TypedContractMethod-like functions so both direct calls and staticCall
            // conversions happen in one place
            if (
                original &&
                typeof original === "function" &&
                typeof original.staticCall === "function"
            ) {
                return wrapContractMethod(original, target);
            }

            const listenerAddMethods = [
                "on",
                "once",
                "addListener",
                "prependListener",
                "prependOnceListener"
            ];
            const listenerRemoveMethods = ["off", "removeListener"];

            if (
                typeof original === "function" &&
                listenerAddMethods.includes(String(prop))
            ) {
                return (...args: any[]) => {
                    if (args.length > 0) {
                        const handlerIndex = args.length - 1;
                        const listener = args[handlerIndex];
                        if (isListener(listener)) {
                            args[handlerIndex] = getWrappedListener(listener);
                        }
                    }
                    return Reflect.apply(original, target, args);
                };
            }

            if (
                typeof original === "function" &&
                listenerRemoveMethods.includes(String(prop))
            ) {
                return (...args: any[]) => {
                    if (args.length > 0) {
                        const handlerIndex = args.length - 1;
                        const listener = args[handlerIndex];
                        if (isListener(listener)) {
                            const wrapped = listenerMap.get(listener);
                            if (wrapped) {
                                args[handlerIndex] = wrapped;
                                listenerMap.delete(listener);
                            }
                        }
                    }
                    return Reflect.apply(original, target, args);
                };
            }

            if (typeof original === "function" && prop === "queryFilter") {
                return async (...args: any[]) => {
                    const logs = await Reflect.apply(original, target, args);
                    if (Array.isArray(logs)) {
                        return logs.map((log) => convertEventLog(log));
                    }
                    return logs;
                };
            }

            // Non-function properties return as-is
            return original;
        }
    }) as T;
}
