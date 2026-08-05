import { Bytes, Hash } from "@/types/types";
import { StateMachineStateStorage } from "../../StateMachineStateStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for raw state-machine-state bytes. Values are
 * already-encoded Bytes usually keyed by keccak256(bytes) - content-addressed,
 * so the bytes round-trip verbatim and are their own changeKey fingerprint
 * (immutable-after-store, the key is sufficient). Replay routes through
 * storeStateMachineState, pinned to the key AS PERSISTED - a caller may have
 * stored these bytes under an explicit hash override (see
 * storeStateMachineState's `options.hash`) that diverges from the
 * content-derived hash storeStateMachineState would otherwise recompute.
 *
 * PO1: opts into bounded diffing - this store is appended before every
 * signature-release barrier (StateManager.success()) for the life of a
 * channel, so a full-scan flush would grow unbounded over a long session.
 */
export function stateMachineStateSchema(
    raw: StateMachineStateStorage
): PersistenceSchema<Bytes> {
    return {
        id: "stateMachineStates",

        entries: function* () {
            for (const [stateHash, bytes] of raw.persistableEntries()) {
                yield [stateHash as string, bytes];
            }
        },

        changeKey: (bytes) => bytes as string,

        encode: (bytes) => bytes as string,

        decode: (encodedBytes) => encodedBytes,

        replay: (encodedBytes, key) => {
            raw.storeStateMachineState(encodedBytes, { hash: key as Hash });
        },

        peekDirtyKeys: () =>
            raw.peekDirtyHashes() as Iterable<readonly [string, number]>,

        clearDirtyKeys: (entries) =>
            raw.clearDirtyHashes(entries as Iterable<readonly [Hash, number]>),

        getEntry: (key) => raw.getPersistableEntry(key as Hash)
    };
}
