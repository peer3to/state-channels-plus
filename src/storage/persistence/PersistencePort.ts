/**
 * Generic platform-agnostic persistence port: a dumb hex KV store, keyed by
 * (namespace, key). The port never encodes/decodes domain structs - schemas
 * own that. Every value crossing the port is a hex string (`encoded`).
 */
export type PersistOp =
    | { type: "put"; key: string; encoded: string }
    | { type: "del"; key: string };

export type NamespacedOp = { namespace: string } & PersistOp;

export type PersistRecord = { key: string; encoded: string };

/**
 * Opaque-clone marker: a value carrying this must be passed through by
 * reference, never structurally deep-cloned. A PersistencePort holds live
 * handles (be-04 IndexedDB, be-05 fs) that a deep clone would corrupt, so every
 * port carries this marker and crosses the `Storage` deepCopyProxy boundary
 * uncloned (see DeepCopyProxy). All port impls should set it.
 */
export const OPAQUE_CLONE: unique symbol = Symbol("peer3.opaqueClone");

export interface PersistencePort {
    /**
     * Opaque-clone marker (see {@link OPAQUE_CLONE}). Ports must never be
     * deep-cloned - DeepCopyProxy passes a marked port through by reference.
     */
    readonly [OPAQUE_CLONE]?: true;
    /** Applies all ops as one durable transaction. */
    commit(ops: NamespacedOp[]): Promise<void>;
    /** Namespace-scoped read of all records. */
    load(namespace: string): AsyncIterable<PersistRecord>;
    /** Deletes records in namespace for which keep returns false. */
    prune(
        namespace: string,
        keep: (r: PersistRecord) => boolean
    ): Promise<void>;
    close?(): Promise<void>;
}
