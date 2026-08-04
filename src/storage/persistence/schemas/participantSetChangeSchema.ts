import { ethers } from "ethers";
import { ForkId, BlockHeight } from "@/types/types";
import { ParticipantSetChangeStorage } from "../../ParticipantSetChangeStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

function encodeChangePoints(changePoints: Set<BlockHeight>): string {
    const sorted = Array.from(changePoints).sort(
        (a, b) => Number(a) - Number(b)
    );
    return persistenceAbiCoder.encode(["uint256[]"], [sorted]);
}

function decodeChangePoints(encoded: string): BlockHeight[] {
    const [heights] = persistenceAbiCoder.decode(["uint256[]"], encoded);
    return Array.from(heights as bigint[]).map((h) => Number(h));
}

/**
 * Durability schema for per-fork participant-set change points. The map key
 * (forkId) is not derivable from the Set content, so replay is pinned to the
 * key AS PERSISTED (see PersistenceSchema.replay's `key` param) rather than
 * trying to recompute it. `changeKey` fingerprints the sorted set CONTENT -
 * storeChangePoint is add-only today, but hashing content (not just size)
 * keeps this correct if that ever changes.
 */
export function participantSetChangeSchema(
    raw: ParticipantSetChangeStorage
): PersistenceSchema<Set<BlockHeight>> {
    return {
        id: "participantSetChanges",

        entries: function* () {
            for (const [forkId, changePoints] of raw.persistableEntries()) {
                yield [forkId as string, changePoints];
            }
        },

        changeKey: (changePoints) =>
            Array.from(changePoints)
                .sort((a, b) => Number(a) - Number(b))
                .join(","),

        encode: encodeChangePoints,

        decode: (encoded) => new Set(decodeChangePoints(encoded)),

        replay: (encoded, key) => {
            for (const height of decodeChangePoints(encoded)) {
                raw.storeChangePoint(key as ForkId, height);
            }
        }
    };
}
