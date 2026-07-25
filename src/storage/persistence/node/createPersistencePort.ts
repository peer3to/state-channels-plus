import { InMemoryPersistencePort } from "../InMemoryPersistencePort";
import { PersistencePort } from "../PersistencePort";

/**
 * Node `@platform/persistence` port factory.
 *
 * Stub until the real fs-backed KV port lands (be-05); returns the in-memory
 * port for now. `namespaceRoot` (`${chainId}:${channelId}`) is the per-channel
 * store scope: the real node port will key its directory/database by it, and
 * the in-memory stub records it on the returned port so the same
 * namespace-scoping contract holds today (and is observable by the host wiring
 * tests). The backend otherwise ignores it until be-05.
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
