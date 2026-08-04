import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, hash, Type } from "@/utils";
import { Hash } from "@/types/types";
import { MessageBlockStorage } from "../../MessageBlockStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for a message-block store. Registered TWICE (distinct
 * `id`s) for the twin inbound/outbound MessageBlockStorage instances - the
 * injected `id` namespaces them at the port so they never collide.
 *
 * Blocks are usually content-addressed (blockHash = hash(Codec.encode(...))),
 * so `changeKey` recomputes the same hash: immutable-after-store, the key is
 * a sufficient fingerprint. Replay routes through `store()`, pinned to the
 * key AS PERSISTED - a caller may have stored this block under an explicit
 * hash override (see `store()`'s `options.hash`) that diverges from the
 * content-derived hash `store()` would otherwise recompute.
 */
export function messageBlocksSchema(
    raw: MessageBlockStorage,
    id: string
): PersistenceSchema<MessageBlockStruct> {
    const encode = (messageBlock: MessageBlockStruct): string =>
        Codec.encode(messageBlock, Type.MessageBlock) as string;

    const decode = (encodedMessageBlock: string): MessageBlockStruct =>
        Codec.decode(encodedMessageBlock, Type.MessageBlock);

    return {
        id,

        entries: function* () {
            for (const [blockHash, messageBlock] of raw.persistableEntries()) {
                yield [blockHash as string, messageBlock];
            }
        },

        changeKey: (messageBlock) => hash(encode(messageBlock)),

        encode,

        decode,

        // Route through the REAL mutator so replay rebuilds
        // latestBlockHash/latestBlockHeight via the same running-max logic.
        replay: (encodedMessageBlock, key) => {
            raw.store(decode(encodedMessageBlock), { hash: key as Hash });
        }
    };
}
