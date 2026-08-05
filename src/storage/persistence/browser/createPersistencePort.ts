import { InMemoryPersistencePort } from "../InMemoryPersistencePort";
import { PersistencePort } from "../PersistencePort";

/**
 * Stub browser port until the real IndexedDB port lands (be-04). Carries a
 * typed `namespaceRoot` (rather than bolting one on via a cast) so the
 * namespace-scoping contract is observable by the host wiring tests today;
 * the real port will key its IndexedDB database by it.
 */
class BrowserPersistencePortStub extends InMemoryPersistencePort {
    readonly namespaceRoot: string;

    constructor(namespaceRoot: string) {
        super();
        this.namespaceRoot = namespaceRoot;
    }
}

/**
 * Browser `@platform/persistence` port factory. Stub until be-04 lands;
 * returns an in-memory-backed port for now.
 */
export function createPersistencePort(opts: {
    namespaceRoot: string;
}): PersistencePort {
    return new BrowserPersistencePortStub(opts.namespaceRoot);
}
