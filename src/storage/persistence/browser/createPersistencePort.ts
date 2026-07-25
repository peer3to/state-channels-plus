import { InMemoryPersistencePort } from "../InMemoryPersistencePort";
import { PersistencePort } from "../PersistencePort";

/**
 * Browser `@platform/persistence` port factory.
 *
 * Stub until the real IndexedDB port lands (be-04); returns the in-memory port
 * for now. `namespaceRoot` (`${chainId}:${channelId}`) is the per-channel store
 * scope: the real browser port will key its IndexedDB database by it, and the
 * in-memory stub records it on the returned port so the same namespace-scoping
 * contract holds today (and is observable by the host wiring tests). The
 * backend otherwise ignores it until be-04.
 */
export function createPersistencePort(opts: {
    namespaceRoot: string;
}): PersistencePort {
    const port = new InMemoryPersistencePort();
    (
        port as InMemoryPersistencePort & { namespaceRoot: string }
    ).namespaceRoot = opts.namespaceRoot;
    return port;
}
