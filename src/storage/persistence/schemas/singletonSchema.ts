import { PersistenceSchema } from "../PersistenceSchema";

/** Duck-typed single-slot store surface (ForceExitStorage, ForceJoinStorage). */
export interface SingletonStore<S> {
    getValue(): S | undefined;
    setValue(value: S): void;
}

/**
 * Durability schema for a single-slot scalar store (forceExit, forceJoin).
 * `entries()` yields one `['value', scalar]` pair when set and NOTHING when
 * unset, so the engine's diff sees the key vanish and emits `del` - modelling
 * a clear()/unset the same way deleteBlock does for a map-based store.
 */
export function singletonSchema<S>(
    raw: unknown,
    id: string
): PersistenceSchema<S> {
    const store = raw as SingletonStore<S>;

    return {
        id,

        entries: function* () {
            const value = store.getValue();
            if (value !== undefined) {
                yield ["value", value];
            }
        },

        // Single slot, immutable once set: the scalar itself is a sufficient
        // fingerprint. S must be JSON-safe (number/boolean) - a bigint
        // scalar would throw here and in encode(); that throw is the
        // intended backstop (see Codec's no-bigint-toJSON-shim rule).
        changeKey: (value) => JSON.stringify(value),

        encode: (value) => JSON.stringify(value),

        decode: (encodedValue) => JSON.parse(encodedValue) as S,

        replay: (encodedValue) => {
            store.setValue(JSON.parse(encodedValue) as S);
        }
    };
}
