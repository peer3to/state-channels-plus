// W1 §6 bucket (iii) - named-op registry. closures never cross the
// orchestrator <-> worker boundary; tests reference ops by stable string id.
// the same registry serves both backends: inline calls the op in-process,
// worker rpc forwards {op, args} -> worker dispatches against the same table.
//
// W0 D-11 - named-op registry IS the seam for closures. tests change at
// source from lambdas to op ids; lambdas never cross at runtime.
// W0 D-22 - test-source changes accepted for closure-bearing overloads.

export type WorkerOpContext = {
    // step 1 - kept loose so domain ops can pull whatever live worker state
    // they need (state manager, p2p manager, etc). domain modules cast to
    // their concrete shape at the call site.
    getStateManager: () => unknown;
    // step 2 - W?: p2p instance accessor. tx-submission ops cast this to the
    // typed P2pInstance and call `.p2pContractInstance.<methodName>(...args)`.
    // throws same W5-style error when set in boot phase.
    getP2pInstance?: () => unknown;
};

export type WorkerOp<TArgs = unknown, TResult = unknown> = (
    ctx: WorkerOpContext,
    args: TArgs
) => Promise<TResult> | TResult;

// step 1 - global registry. populated at boot by bundle-manifest side-effect
// imports (W2 §4.5). domain modules (test/harness/threaded/worker-ops/*.ts)
// call `registerOp(id, fn)` once per op; the registry persists for the
// lifetime of the isolate. duplicate registration throws -> stale entries
// surface loudly rather than silently overwriting.
const REGISTRY = new Map<string, WorkerOp>();

export class WorkerOpAlreadyRegisteredError extends Error {
    constructor(id: string) {
        super(
            `worker op '${id}' is already registered. ` +
                `op ids are unique per isolate; either two modules tried to register ` +
                `the same id, or the bundle manifest imported the same domain twice.`
        );
        this.name = "WorkerOpAlreadyRegisteredError";
    }
}

export class WorkerOpNotFoundError extends Error {
    constructor(id: string) {
        super(
            `worker op '${id}' not found. ` +
                `op ids must be registered via registerOp() at worker boot via the ` +
                `bundle manifest. ensure the orchestrator's spawn args include the ` +
                `module that calls registerOp("${id}", ...).`
        );
        this.name = "WorkerOpNotFoundError";
    }
}

export function registerOp<TArgs, TResult>(
    id: string,
    fn: WorkerOp<TArgs, TResult>
): void {
    if (REGISTRY.has(id)) {
        throw new WorkerOpAlreadyRegisteredError(id);
    }
    REGISTRY.set(id, fn as WorkerOp);
}

export function getOp(id: string): WorkerOp {
    const fn = REGISTRY.get(id);
    if (!fn) throw new WorkerOpNotFoundError(id);
    return fn;
}

export function hasOp(id: string): boolean {
    return REGISTRY.has(id);
}

// step 1 - introspection for tests / lint. NOT part of the runtime hot path.
export function listOps(): readonly string[] {
    return [...REGISTRY.keys()];
}

// step 1 - test-only reset. real workers never call this; isolates are
// short-lived and registrations are boot-once. exposed for unit tests that
// exercise the registry shape.
export function _resetOpsRegistryForTests(): void {
    REGISTRY.clear();
}
