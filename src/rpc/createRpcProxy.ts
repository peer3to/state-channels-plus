import type Rpc from "./Rpc";

export function createRpcMethodProxy(
    service: string | (() => string),
    deliver: (rpc: Rpc) => unknown
) {
    return new Proxy(
        {},
        {
            get(target, prop, receiver) {
                if (Reflect.has(target, prop))
                    return Reflect.get(target, prop, receiver);
                if (typeof prop === "symbol" || prop === "then")
                    return undefined;
                return (...params: unknown[]) =>
                    deliver({
                        service:
                            typeof service === "string" ? service : service(),
                        method: prop,
                        params
                    });
            }
        }
    );
}

export function createRpcProxy(
    deliver: (rpc: Rpc) => unknown,
    target: object = {},
    validateService?: (service: string) => void
) {
    // Service names select one cached method proxy per root.
    const services = new Map<string, object>();
    return new Proxy(target, {
        get(root, prop, receiver) {
            // Avoid breaking common JS runtime inspection paths.
            if (typeof prop === "symbol")
                return Reflect.get(root, prop, receiver);
            if (prop === "then") return undefined;
            validateService?.(prop);
            // Create and cache proxy per service
            if (!services.has(prop))
                services.set(prop, createRpcMethodProxy(prop, deliver));
            return services.get(prop);
        }
    });
}
