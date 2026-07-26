import StateSnapshot from "@/models/StateSnapshot";
import { Hash } from "@/types/types";
import { StateSnapshotStorage } from "../../StateSnapshotStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for state snapshots. StateSnapshot self-serializes
 * (encode()/decode()) via Codec.Type.StateSnapshot. snapshot.hash is usually
 * content-derived, so `changeKey` recomputes it: immutable-after-store, the
 * key is a sufficient fingerprint. Replay routes through storeStateSnapshot,
 * pinned to the key AS PERSISTED - a caller may have stored this snapshot
 * under an explicit hash override (see storeStateSnapshot's `options.hash`)
 * that diverges from the content-derived hash storeStateSnapshot would
 * otherwise recompute - and rebuilds the derived genesisSnapshotByForkId
 * index.
 */
export function stateSnapshotSchema(
    raw: StateSnapshotStorage
): PersistenceSchema<StateSnapshot> {
    return {
        id: "stateSnapshots",

        entries: function* () {
            for (const [snapshotHash, snapshot] of raw.persistableEntries()) {
                yield [snapshotHash as string, snapshot];
            }
        },

        changeKey: (snapshot) => snapshot.hash as string,

        encode: (snapshot) => snapshot.encode() as string,

        decode: (encodedSnapshot) => StateSnapshot.decode(encodedSnapshot),

        replay: (encodedSnapshot, key) => {
            raw.storeStateSnapshot(StateSnapshot.decode(encodedSnapshot), {
                hash: key as Hash
            });
        }
    };
}
