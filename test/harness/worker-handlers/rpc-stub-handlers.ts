// W1 §6 bucket (iii) / D-22 - named rpc-stub handler registry. tests register
// the stub body once under a stable string id; the install call carries the id
// (+ handlerArgs) instead of a lambda. the same registry serves both backends:
// inline calls the handler in-process; worker rpc forwards {handlerId, args}
// and the worker dispatches against the same table.
//
// shape: the handler replaces a method on the rpc methods object that
// service.createRPCMethods(transport) returns. service-side caller invokes the
// stub as `methods[methodName](...args)` with `this` bound to the service's
// rpc-methods instance. the handler context surfaces all three (`this`, args,
// handlerArgs) so the body can do anything the prior closure did.

export type RpcStubHandlerContext = {
    // step 1 - the `this` value the rpc methods instance gets when invoked.
    // services expose `senderTransport`, `service`, `remoteRpc` on this binding;
    // typed loose so handlers cast at the call site.
    thisCtx: unknown;
    // step 1 - args the rpc kernel passed to methods[methodName]
    args: readonly unknown[];
    // step 1 - install-time config; whatever the test passed as handlerArgs.
    // structured-cloneable so it survives the orchestrator -> worker hop.
    handlerArgs: unknown;
};

export type RpcStubHandler = (
    ctx: RpcStubHandlerContext
) => Promise<unknown> | unknown;

const REGISTRY = new Map<string, RpcStubHandler>();

export class RpcStubHandlerAlreadyRegisteredError extends Error {
    constructor(id: string) {
        super(
            `rpc-stub handler '${id}' is already registered. ` +
                `handler ids are unique per isolate; either two modules registered ` +
                `the same id, or the bundle manifest imported the same handler twice.`
        );
        this.name = "RpcStubHandlerAlreadyRegisteredError";
    }
}

export class RpcStubHandlerNotFoundError extends Error {
    constructor(id: string) {
        super(
            `rpc-stub handler '${id}' not found. handler ids must be registered ` +
                `at boot via test/harness/worker-handlers/index.ts (orchestrator) ` +
                `or via the worker bundle manifest.`
        );
        this.name = "RpcStubHandlerNotFoundError";
    }
}

export function registerRpcStubHandler(id: string, fn: RpcStubHandler): void {
    if (REGISTRY.has(id)) throw new RpcStubHandlerAlreadyRegisteredError(id);
    REGISTRY.set(id, fn);
}

export function getRpcStubHandler(id: string): RpcStubHandler {
    const fn = REGISTRY.get(id);
    if (!fn) throw new RpcStubHandlerNotFoundError(id);
    return fn;
}

export function hasRpcStubHandler(id: string): boolean {
    return REGISTRY.has(id);
}

// step 1 - introspection for tests / lint. NOT part of any runtime hot path.
export function listRpcStubHandlers(): readonly string[] {
    return [...REGISTRY.keys()];
}

// step 1 - test-only reset. exposed so unit tests that exercise the registry
// shape can start from a clean slate.
export function _resetRpcStubHandlerRegistryForTests(): void {
    REGISTRY.clear();
}

// step 1 - ephemeral handler escape hatch. tests that genuinely need a
// test-local closure (e.g. asserting a boolean toggle) register a uniquely-
// named handler, run the test body, then unregister. worker mode requires
// the handler to be registered inside the worker isolate at boot, so this is
// inline-mode-only by construction; callers paired with the named-id pattern
// for cross-isolate work. callers must use a unique id (uuid / test-local) to
// avoid collision with shipped handlers.
export function registerTemporaryRpcStubHandler(
    id: string,
    fn: RpcStubHandler
): () => void {
    registerRpcStubHandler(id, fn);
    return () => {
        REGISTRY.delete(id);
    };
}
