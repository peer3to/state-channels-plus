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

    /**
     * Decode + route through the store's REAL mutator (merges over live
     * memory). `key` is the durable record's own map key (from `entries()`),
     * passed through so a schema whose store accepts a key/hash override can
     * pin replay to the key AS PERSISTED rather than trusting the mutator to
     * re-derive an identical key from content - the two can diverge when a
     * caller stored under an explicit override (see stateSnapshotSchema /
     * stateMachineStateSchema / messageBlocksSchema / blocksSchema).
     */
    replay(encodedValue: string, key: string): void;

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

    /**
     * Bounded-diff opt-in (PO1): peek keys mutated since the last
     * successfully-committed flush, WITHOUT clearing them (retry-safe - a
     * failed commit must re-diff the same keys next attempt). When present
     * (with `clearDirtyKeys` and `getEntry`), a flush only re-diffs these
     * keys instead of a full `entries()` scan, bounding barrier cost as
     * retained history grows. Optional: a schema without this always gets
     * the full-scan fallback (the safe default - still catches a mutation
     * however it happened, including one that bypassed dirty-marking).
     */
    peekDirtyKeys?(): Iterable<string>;

    /**
     * Clears exactly these keys from the dirty set - called ONLY after
     * their diff was durably committed. Any key mutated again after the
     * peek (but before this call) must stay dirty for the next flush.
     */
    clearDirtyKeys?(keys: Iterable<string>): void;

    /**
     * Random-access lookup for one key's CURRENT value (or undefined if
     * deleted/absent), applying the exact same filtering as `entries()`
     * (e.g. excluding justPersist hashes). Required alongside
     * `peekDirtyKeys`/`clearDirtyKeys`.
     */
    getEntry?(key: string): V | undefined;
}
