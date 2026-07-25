import { Bytes } from "@/types/types";
import { StateMachineStateStorage } from "../../StateMachineStateStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for raw state-machine-state bytes. Values are
 * already-encoded Bytes keyed by keccak256(bytes) - content-addressed, so the
 * bytes round-trip verbatim and are their own changeKey fingerprint (
 * immutable-after-store, the key is sufficient). Replay routes through
 * storeStateMachineState, which recomputes the same hash from content.
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

        replay: (encodedBytes) => {
            raw.storeStateMachineState(encodedBytes);
        }
    };
}
