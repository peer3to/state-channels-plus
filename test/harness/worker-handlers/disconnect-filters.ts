// W1 §6 bucket (iii) / D-22 - named disconnect-filter registry. tests register
// a filter body once under a stable string id; install carries the id (+
// filterArgs) instead of a lambda. shape mirrors the one-off pattern in
// RPCActions.requestFakeDisputeWithSpiedDisconnect: the filter is a predicate
// + side effect over `disconnectAndBlacklistPeerByEvmAddress(addr)`; returning
// `false` from `decide` short-circuits the original. `true` allows it through.

export type DisconnectFilterContext = {
    // step 1 - the address argument the wrapped method received.
    address: string;
    // step 1 - install-time config; whatever the test passed as filterArgs.
    filterArgs: unknown;
};

export type DisconnectFilter = (
    ctx: DisconnectFilterContext
) => boolean | Promise<boolean>;

const REGISTRY = new Map<string, DisconnectFilter>();

export class DisconnectFilterAlreadyRegisteredError extends Error {
    constructor(id: string) {
        super(
            `disconnect filter '${id}' is already registered. filter ids are ` +
                `unique per isolate; either two modules registered the same id, ` +
                `or the bundle manifest imported the same filter twice.`
        );
        this.name = "DisconnectFilterAlreadyRegisteredError";
    }
}

export class DisconnectFilterNotFoundError extends Error {
    constructor(id: string) {
        super(
            `disconnect filter '${id}' not found. filter ids must be registered ` +
                `at boot via test/harness/worker-handlers/index.ts (orchestrator) ` +
                `or via the worker bundle manifest.`
        );
        this.name = "DisconnectFilterNotFoundError";
    }
}

export function registerDisconnectFilter(
    id: string,
    fn: DisconnectFilter
): void {
    if (REGISTRY.has(id)) throw new DisconnectFilterAlreadyRegisteredError(id);
    REGISTRY.set(id, fn);
}

export function getDisconnectFilter(id: string): DisconnectFilter {
    const fn = REGISTRY.get(id);
    if (!fn) throw new DisconnectFilterNotFoundError(id);
    return fn;
}

export function hasDisconnectFilter(id: string): boolean {
    return REGISTRY.has(id);
}

export function listDisconnectFilters(): readonly string[] {
    return [...REGISTRY.keys()];
}

export function _resetDisconnectFilterRegistryForTests(): void {
    REGISTRY.clear();
}

export function registerTemporaryDisconnectFilter(
    id: string,
    fn: DisconnectFilter
): () => void {
    registerDisconnectFilter(id, fn);
    return () => {
        REGISTRY.delete(id);
    };
}
