import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, hash, Type } from "@/utils";
import { MessageBlockStorage } from "../../MessageBlockStorage";
import { PersistenceSchema } from "../PersistenceSchema";

/**
 * Durability schema for a message-block store. Registered TWICE (distinct
 * `id`s) for the twin inbound/outbound MessageBlockStorage instances - the
 * injected `id` namespaces them at the port so they never collide.
 *
 * Blocks are content-addressed (blockHash = hash(Codec.encode(...))), so
 * `changeKey` recomputes the same hash: immutable-after-store, the key is a
 * sufficient fingerprint. Replay routes through `store()`, which recomputes
 * the same hash from content and re-runs the running-max latest-pointer
 * update - no need to thread the map key through separately.
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
        replay: (encodedMessageBlock) => {
            raw.store(decode(encodedMessageBlock));
        }
    };
}
