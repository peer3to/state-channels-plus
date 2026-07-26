import { ethers } from "ethers";
import { PersistenceSchema } from "../PersistenceSchema";

/** Duck-typed single-slot store surface (ForceExitStorage, ForceJoinStorage). */
export interface SingletonStore<S> {
    getValue(): S | undefined;
    setValue(value: S): void;
}

function encodeValue<S>(value: S): string {
    return ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(value)));
}

function decodeValue<S>(encodedValue: string): S {
    return JSON.parse(ethers.toUtf8String(ethers.getBytes(encodedValue))) as S;
}

/**
 * Durability schema for a single-slot scalar store (forceExit, forceJoin).
 * `entries()` yields one `['value', scalar]` pair when set and NOTHING when
 * unset, so the engine's diff sees the key vanish and emits `del` - modelling
 * a clear()/unset the same way deleteBlock does for a map-based store.
 */
export function singletonSchema<S>(
    store: SingletonStore<S>,
    id: string
): PersistenceSchema<S> {
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

        encode: encodeValue,

        decode: decodeValue,

        replay: (encodedValue) => {
            store.setValue(decodeValue(encodedValue));
        }
    };
}
