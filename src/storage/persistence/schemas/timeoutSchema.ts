import { ethers } from "ethers";
import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils/Codec";
import { ForkId } from "@/types/types";
import { TimeoutStorage } from "../../TimeoutStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

// TimeoutStorage's map key (ForkId) is NOT derivable from TimeoutStruct
// content, unlike the content-addressed stores. entries() carries it as an
// extra own property on the yielded value (structurally still a
// TimeoutStruct) so encode()/changeKey() - which only ever see the value,
// never the key - can still round-trip it into the envelope.
type TimeoutRecord = TimeoutStruct & { forkId: ForkId };

function encodeTimeout(record: TimeoutRecord): string {
    const { forkId, ...timeout } = record;
    const encodedTimeout = Codec.encode(timeout, Type.Timeout);
    return persistenceAbiCoder.encode(
        ["bytes32", "bytes"],
        [forkId, encodedTimeout]
    );
}

function decodeTimeout(encodedRecord: string): TimeoutRecord {
    const [forkId, encodedTimeout] = persistenceAbiCoder.decode(
        ["bytes32", "bytes"],
        encodedRecord
    );
    return {
        ...Codec.decode(encodedTimeout, Type.Timeout),
        forkId: forkId as ForkId
    };
}

/**
 * Durability schema for the per-fork timeout store. `changeKey` fingerprints
 * all durable-mutable fields (the whole struct content, forkId included) so
 * a replaced timeout is re-diffed. Replay routes through storeTimeout, which
 * KEEPS THE EARLIEST (rejects a higher blockHeight) - preserving that merge
 * semantics on replay.
 */
export function timeoutSchema(
    raw: TimeoutStorage
): PersistenceSchema<TimeoutStruct> {
    return {
        id: "timeout",

        entries: function* () {
            for (const [forkId, timeout] of raw.persistableEntries()) {
                const record: TimeoutRecord = { ...timeout, forkId };
                yield [forkId as string, record];
            }
        },

        changeKey: (timeout) => {
            // Keep this field list in sync with TimeoutStruct - a new struct
            // field must be added here too or it won't be fingerprinted.
            const record = timeout as TimeoutRecord;
            return [
                record.forkId,
                record.participant,
                record.blockHeight,
                record.minTimeStamp,
                record.isForced,
                record.previousBlockProducer,
                record.previousBlockProducerPostedCalldata,
                record.participantSignatureOnPreviousBlock
            ].join(":");
        },

        encode: (timeout) => encodeTimeout(timeout as TimeoutRecord),

        decode: decodeTimeout,

        replay: (encodedRecord) => {
            const { forkId, ...timeout } = decodeTimeout(encodedRecord);
            raw.storeTimeout(forkId, timeout);
        }
    };
}
