// @spec-test-coverage-ignore: shared fixture builds real signed blocks; executable evidence belongs to its calling test declarations
import Block from "@/models/Block";
import type { Address } from "@/types/types";
import { block as blockFactory } from "@test/factory";
import { contractRejectedEncodings } from "@test/fixtures/SignatureEncodingFixture";
import { ethers } from "ethers";

/** A block authored and signed by `author`, confirmed by `confirmers`. */
export async function authoredConfirmedBlock(
    author: ethers.HDNodeWallet,
    confirmers: ethers.HDNodeWallet[]
): Promise<Block> {
    const authored = blockFactory({
        header: { participant: author.address as Address }
    });
    const block = Block.fromSignedBlock(await authored.signBlock(author));
    block.expandSignatures(
        await Promise.all(confirmers.map((confirmer) => block.sign(confirmer)))
    );
    return block;
}

/**
 * `signer`'s real signature over `block`, re-encoded in one of the
 * encodings the contracts reject (see contractRejectedEncodings).
 */
export async function contractRejectedSignature(
    block: Block,
    signer: ethers.HDNodeWallet,
    encoding: "high s" | "v of 0/1"
): Promise<string> {
    return rejectedEncoding(await block.sign(signer), encoding);
}

/** One signature re-encoded in a contract-rejected encoding. */
export function rejectedEncoding(
    signature: ethers.SignatureLike,
    encoding: "high s" | "v of 0/1"
): string {
    return contractRejectedEncodings(
        ethers.Signature.from(signature).serialized
    )[encoding];
}
