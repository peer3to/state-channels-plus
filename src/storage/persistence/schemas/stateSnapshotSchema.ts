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
 *
 * PO1: opts into bounded diffing - this store is appended before every
 * signature-release barrier (StateManager.success()) for the life of a
 * channel, so a full-scan flush would grow unbounded over a long session.
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
        },

        peekDirtyKeys: () =>
            raw.peekDirtyHashes() as Iterable<readonly [string, number]>,

        clearDirtyKeys: (entries) =>
            raw.clearDirtyHashes(entries as Iterable<readonly [Hash, number]>),

        getEntry: (key) => raw.getPersistableEntry(key as Hash)
    };
}
