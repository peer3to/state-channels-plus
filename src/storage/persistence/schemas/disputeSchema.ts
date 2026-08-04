import { ethers } from "ethers";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils/Codec";
import { Hash, ForkId } from "@/types/types";
import { DisputeStorage } from "../../DisputeStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for the disputes map. `changeKey` fingerprints the
 * signature set CONTENT (sorted join), not size - _storeDisputeConfirmationWithOptions
 * merges are monotonic-only today (union, never shrinks), but hashing content
 * keeps this correct if that ever changes. Replay routes through
 * storeDisputeConfirmation, pinned to the key AS PERSISTED (a caller may have
 * stored under an explicit hash override - see storeDisputeConfirmation's
 * `options.hash`) so a divergent override can't mis-key on replay.
 */
export function disputeSchema(
    raw: DisputeStorage
): PersistenceSchema<DisputeConfirmationStruct> {
    return {
        id: "disputes",

        entries: function* () {
            for (const [hash, confirmation] of raw.persistableEntries()) {
                yield [hash as string, confirmation];
            }
        },

        changeKey: (confirmation) =>
            Array.from(confirmation.signatures).sort().join(","),

        encode: (confirmation) =>
            Codec.encode(confirmation, Type.DisputeConfirmation) as string,

        decode: (encoded) => Codec.decode(encoded, Type.DisputeConfirmation),

        replay: (encoded, key) => {
            raw.storeDisputeConfirmation(
                Codec.decode(encoded, Type.DisputeConfirmation),
                { hash: key as Hash }
            );
        }
    };
}

/**
 * Durability schema for the disputedForks side-map (did-I-already-dispute-this-fork
 * flag). Registered under its own id ("disputedForks") since it's an
 * independent map on the same DisputeStorage instance, not derivable from the
 * disputes map. The value is a plain boolean hex-encoded (never a bare JSON
 * string crossing the hex-only port).
 */
export function disputedForkSchema(
    raw: DisputeStorage
): PersistenceSchema<boolean> {
    return {
        id: "disputedForks",

        entries: function* () {
            for (const [
                forkId,
                disputed
            ] of raw.persistableDisputedForkEntries()) {
                yield [forkId as string, disputed];
            }
        },

        changeKey: (disputed) => JSON.stringify(disputed),

        encode: (disputed) =>
            ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(disputed))),

        decode: (encoded) =>
            JSON.parse(ethers.toUtf8String(ethers.getBytes(encoded))),

        replay: (encoded, key) => {
            const disputed = JSON.parse(
                ethers.toUtf8String(ethers.getBytes(encoded))
            );
            raw.storeDisputedFork(key as ForkId, disputed);
        }
    };
}
