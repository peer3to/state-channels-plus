import { ethers } from "ethers";
import { Block } from "@/models";
import { Codec, Type } from "@/utils/Codec";
import { Hash } from "@/types/types";
import { BlockStorage } from "../../BlockStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

/**
 * Pack the block's full mutable state (signatures + onChainTimestamp) into a
 * single encoded blob. The block's own struct is Codec-encoded; the outer
 * wrapper (signature/confirmations/timestamp) uses the same ABI-encoding
 * mechanism rather than structuredClone (BytesLike/bigint don't survive that).
 */
function encodeBlock(block: Block): string {
    const encodedConfirmation = Codec.encode(
        block.blockConfirmationStruct,
        Type.BlockConfirmation
    );
    return persistenceAbiCoder.encode(
        ["bytes", "uint256"],
        [encodedConfirmation, block.onChainTimestamp ?? 0]
    );
}

function decodeBlock(encodedBlock: string): Block {
    const [encodedConfirmation, onChainTimestampRaw] =
        persistenceAbiCoder.decode(["bytes", "uint256"], encodedBlock);
    const blockConfirmation = Codec.decode(
        encodedConfirmation,
        Type.BlockConfirmation
    );
    const onChainTimestamp =
        onChainTimestampRaw === 0n ? undefined : Number(onChainTimestampRaw);
    return Block.fromBlockConfirmation(blockConfirmation, onChainTimestamp);
}

/**
 * Durability schema for the dispute-read block store.
 *
 * PO1: opts into bounded diffing (peekDirtyKeys/clearDirtyKeys/getEntry) since
 * this store's retained history keeps growing for the life of a channel and
 * every signed block re-triggers a flush - a full entries() scan would cost
 * O(retained history) on every gossip. `entries()` stays as the full-scan
 * fallback (used by nothing today, kept for interface conformance / a schema
 * consumer that doesn't want bounded diffing).
 *
 * `changeKey` hashes the signature-set CONTENT (sorted join), never its size:
 * Block.removeConfirmationSignatures shrinks the set, so a size-invariant
 * membership change (strip X, add C) must still produce a different key.
 */
export function blocksSchema(raw: BlockStorage): PersistenceSchema<Block> {
    const changeKey = (block: Block) => {
        const sigSetHash = Array.from(block.confirmationSignatures)
            .sort()
            .join(",");
        return `${block.hash}:${sigSetHash}:${block.onChainTimestamp ?? 0}`;
    };

    return {
        id: "blocks",

        // hashToBlockMap keys are always hex-string hashes at runtime; Hash is
        // the broader BytesLike, so narrow to the string key the engine uses.
        entries: function* () {
            for (const [hash, block] of raw.persistableEntries()) {
                yield [hash as string, block];
            }
        },

        changeKey,

        encode: encodeBlock,

        decode: decodeBlock,

        // Route through the REAL mutator so a replayed record merges over live
        // memory (signature union) instead of clobbering it. Pin the hash to
        // the key AS PERSISTED - a caller may have stored this block under an
        // explicit hash override that diverges from the content-derived hash
        // the mutator would otherwise recompute.
        replay: (encodedBlock, key) => {
            raw.storeBlock(decodeBlock(encodedBlock), { hash: key as Hash });
        },

        peekDirtyKeys: () =>
            raw.peekDirtyHashes() as Iterable<readonly [string, number]>,

        clearDirtyKeys: (entries) =>
            raw.clearDirtyHashes(entries as Iterable<readonly [Hash, number]>),

        getEntry: (key) => raw.getPersistableEntry(key as Hash)
    };
}
