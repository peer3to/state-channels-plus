export class DebugProxy {
    public static createProxy<T extends object>(original: T) {
        return new Proxy(original, {
            get(target, prop, receiver) {
                const original = Reflect.get(target, prop, receiver);
                if (typeof original === "function") {
                    return function (...args: any[]) {
                        console.log(
                            "\x1b[35m%s\x1b[0m",
                            `${target.constructor.name} - ${String(
                                prop
                            )} - ${args.toString().replace(/,/g, ",\n")}`
                        );
                        return Reflect.apply(original, target, args);
                    };
                }
                return original;
            }
        });
    }
}
