class DebugProxy {
    public static createProxy<T extends Object>(original: T) {
        return new Proxy(original, {
            get(target, prop, receiver) {
                let original = Reflect.get(target, prop, receiver);
                if (typeof original === "function") {
                    return function (...args: any[]) {
                        console.log(
                            "\x1b[35m%s\x1b[0m",
                            `${target.constructor.name} - ${String(
                                prop
                            )} - ${args.toString().replace(/,/g, ",\n")}`
                        );
                        return Reflect.apply(
                            original as Function,
                            target,
                            args
                        );
                    };
                }
                return original;
            }
        });
    }
}
export default DebugProxy;

class A {
    a = 2;
    public someFunction(firstArg: string, secondArg: number) {
        firstArg + "1";
        secondArg + 1;
    }
}
const main = () => {
    let original = new A();
    let proxy = DebugProxy.createProxy(original);
    proxy.someFunction("a", 1);
    console.log(proxy.a);
};

main();
