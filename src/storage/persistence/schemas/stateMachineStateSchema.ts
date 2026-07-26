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
        }
    };
}
