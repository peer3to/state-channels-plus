import { ethers } from "ethers";
import { Block } from "@/models";
import { Codec, Type } from "@/utils/Codec";
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
 * Durability schema for the dispute-read block store. The engine content-diffs
 * `entries()` (the store's primary map minus justPersist milestones) and
 * fingerprints each block with `changeKey`.
 *
 * `changeKey` hashes the signature-set CONTENT (sorted join), never its size:
 * Block.removeConfirmationSignatures shrinks the set, so a size-invariant
 * membership change (strip X, add C) must still produce a different key.
 */
export function blocksSchema(raw: BlockStorage): PersistenceSchema<Block> {
    return {
        id: "blocks",

        // hashToBlockMap keys are always hex-string hashes at runtime; Hash is
        // the broader BytesLike, so narrow to the string key the engine uses.
        entries: function* () {
            for (const [hash, block] of raw.persistableEntries()) {
                yield [hash as string, block];
            }
        },

        changeKey: (block) => {
            const sigSetHash = Array.from(block.confirmationSignatures)
                .sort()
                .join(",");
            return `${block.hash}:${sigSetHash}:${block.onChainTimestamp ?? 0}`;
        },

        encode: encodeBlock,

        decode: decodeBlock,

        // Route through the REAL mutator so a replayed record merges over live
        // memory (signature union) instead of clobbering it.
        replay: (encodedBlock) => {
            raw.storeBlock(decodeBlock(encodedBlock));
        }
    };
}
