import { InMemoryPersistencePort } from "../InMemoryPersistencePort";
import { PersistencePort } from "../PersistencePort";

/**
 * Stub node port until the real fs-backed KV port lands (be-05). Carries a
 * typed `namespaceRoot` (rather than bolting one on via a cast) so the
 * namespace-scoping contract is observable by the host wiring tests today;
 * the real port will key its directory/database by it.
 */
class NodePersistencePortStub extends InMemoryPersistencePort {
    readonly namespaceRoot: string;

    constructor(namespaceRoot: string) {
        super();
        this.namespaceRoot = namespaceRoot;
    }
}

/**
 * Node `@platform/persistence` port factory. Stub until be-05 lands; returns
 * an in-memory-backed port for now.
 */
export function createPersistencePort(opts: {
    namespaceRoot: string;
}): PersistencePort {
    return new NodePersistencePortStub(opts.namespaceRoot);
}
