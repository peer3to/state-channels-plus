import { ethers } from "ethers";
import { ChannelId } from "@/types/types";
import { EventSyncStorage } from "../../EventSyncStorage";
import { PersistenceSchema } from "../PersistenceSchema";

function encodeBlockNumber(blockNumber: number): string {
    return ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(blockNumber)));
}

function decodeBlockNumber(encoded: string): number {
    return JSON.parse(ethers.toUtf8String(ethers.getBytes(encoded)));
}

/**
 * Durability schema for the per-channel latest-processed-block watermark. The
 * map key (a lowercased channelId string) is not derivable from the plain
 * number value, so replay is pinned to the key AS PERSISTED (see
 * PersistenceSchema.replay's `key` param) - storeLatestProcessedBlock
 * re-lowercases it, which is idempotent on an already-lowercased key.
 * `changeKey` is the value itself: storeLatestProcessedBlock is a running
 * max, so any change is a real increase worth re-diffing.
 */
export function eventSyncSchema(
    raw: EventSyncStorage
): PersistenceSchema<number> {
    return {
        id: "eventSync",

        entries: function* () {
            yield* raw.persistableEntries();
        },

        changeKey: (blockNumber) => String(blockNumber),

        encode: encodeBlockNumber,

        decode: decodeBlockNumber,

        replay: (encoded, key) => {
            raw.storeLatestProcessedBlock(
                key as ChannelId,
                decodeBlockNumber(encoded)
            );
        }
    };
}
