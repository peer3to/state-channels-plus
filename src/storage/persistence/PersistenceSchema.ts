/**
 * Declarative, per-store persistence contract consumed by PersistenceEngine.
 *
 * A schema is the ONLY thing that knows a store's codec and mutators. The
 * engine never intercepts mutators - it content-diffs `entries()` (the store's
 * PRIMARY map) at flush time, fingerprinting each value with `changeKey`.
 */

/** Opaque placeholder; be-07 defines the real watermark shape. */
export type PruneWatermark = unknown;

export interface PersistenceSchema<V> {
    /** Namespace; injected for the twin MessageBlockStorage instances. */
    id: string;

    /** Reads the store's PRIMARY map only. */
    entries(): Iterable<[key: string, value: V]>;

    /**
     * Cheap fingerprint of ALL durable-mutable fields. For set-valued fields
     * this MUST hash set CONTENT, not cardinality - signature sets are not
     * append-only, so a size-invariant membership change ({A,B,X} -> {A,B,C})
     * must produce a different key.
     */
    changeKey(value: V): string;

    /** Serialize to hex (`encoded*`). */
    encode(value: V): string;

    /** Decode + route through the store's REAL mutator (merges over live memory). */
    replay(encodedValue: string): void;

    /**
     * Decode an encoded record to its value WITHOUT merging into live memory.
     * Used by hydrate to seed the durable-shadow from the record as-written
     * (pre-merge) so a pre-hydrate live mutation is not masked. Optional: a
     * schema without it seeds no shadow entry and the record is safely
     * re-persisted (over-flush) on the next flush.
     */
    decode?(encodedValue: string): V;

    /** be-07 pruning policy. */
    pruneKeep?(key: string, watermark: PruneWatermark): boolean;
}
