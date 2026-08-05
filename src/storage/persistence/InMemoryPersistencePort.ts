import {
    NamespacedOp,
    OPAQUE_CLONE,
    PersistencePort,
    PersistRecord
} from "./PersistencePort";

/**
 * Default backing until the real IndexedDB (be-04) and node (be-05) ports
 * land. Keeps a `Map<namespace, Map<key, encoded>>` in memory.
 */
export class InMemoryPersistencePort implements PersistencePort {
    // Never deep-clone a port (see OPAQUE_CLONE) - real ports hold live handles.
    readonly [OPAQUE_CLONE] = true as const;
    private readonly store = new Map<string, Map<string, string>>();

    async commit(ops: NamespacedOp[]): Promise<void> {
        for (const op of ops) {
            const namespaceMap = this.namespaceMap(op.namespace);
            if (op.type === "put") {
                namespaceMap.set(op.key, op.encoded);
            } else {
                namespaceMap.delete(op.key);
            }
        }
    }

    async *load(namespace: string): AsyncIterable<PersistRecord> {
        const namespaceMap = this.store.get(namespace);
        if (!namespaceMap) return;
        for (const [key, encoded] of namespaceMap) {
            yield { key, encoded };
        }
    }

    async prune(
        namespace: string,
        keep: (r: PersistRecord) => boolean
    ): Promise<void> {
        const namespaceMap = this.store.get(namespace);
        if (!namespaceMap) return;
        for (const [key, encoded] of namespaceMap) {
            if (!keep({ key, encoded })) {
                namespaceMap.delete(key);
            }
        }
    }

    private namespaceMap(namespace: string): Map<string, string> {
        let namespaceMap = this.store.get(namespace);
        if (!namespaceMap) {
            namespaceMap = new Map<string, string>();
            this.store.set(namespace, namespaceMap);
        }
        return namespaceMap;
    }
}
