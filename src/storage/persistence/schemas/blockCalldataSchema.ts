import { ethers } from "ethers";
import { BlockCalldata } from "@/types/types";
import { Codec, Type } from "@/utils/Codec";
import { BlockCalldataStorage } from "../../BlockCalldataStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

function encodeBlockCalldata(blockCalldata: BlockCalldata): string {
    const encodedSignedBlock = Codec.encode(
        blockCalldata.signedBlock,
        Type.SignedBlock
    );
    return persistenceAbiCoder.encode(
        ["bytes", "uint256"],
        [encodedSignedBlock, blockCalldata.onChainTimestamp]
    );
}

function decodeBlockCalldata(encoded: string): BlockCalldata {
    const [encodedSignedBlock, onChainTimestamp] = persistenceAbiCoder.decode(
        ["bytes", "uint256"],
        encoded
    );
    return {
        signedBlock: Codec.decode(encodedSignedBlock, Type.SignedBlock),
        onChainTimestamp: Number(onChainTimestamp)
    };
}

/**
 * Durability schema for posted-calldata blocks (dispute-read). The map key
 * (`forkId:height:author`) is fully re-derivable from `signedBlock` content
 * (storeBlockCalldata computes it the same way), and storeBlockCalldata has
 * no key override - no need to thread the persisted key through replay.
 * storeBlockCalldata unconditionally overwrites, so `changeKey` fingerprints
 * the FULL encoded envelope (never just the key) so a re-post with a
 * different onChainTimestamp is still picked up by the flush diff.
 */
export function blockCalldataSchema(
    raw: BlockCalldataStorage
): PersistenceSchema<BlockCalldata> {
    return {
        id: "blockCalldata",

        entries: function* () {
            for (const [key, blockCalldata] of raw.persistableEntries()) {
                yield [key, blockCalldata];
            }
        },

        changeKey: (blockCalldata) => encodeBlockCalldata(blockCalldata),

        encode: encodeBlockCalldata,

        decode: decodeBlockCalldata,

        replay: (encoded) => {
            raw.storeBlockCalldata(decodeBlockCalldata(encoded));
        }
    };
}
