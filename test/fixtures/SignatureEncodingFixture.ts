// @spec-test-coverage-ignore: shared fixture builds real signatures and their encodings; executable evidence belongs to its calling test declarations
import { signBlockVariant } from "./QueueAdmissionFixture";
import { DoubleSignatureReport, onDoubleSignature } from "@/cache";
import { Signature } from "@/types/types";
import { ethers } from "ethers";

/** Byte encodings that recover to the same signer as the 65-byte v 27/28 form. */
export type SignatureEncoding = "yParity" | "eip155" | "compact";

/**
 * Re-encode one real signature without changing its (r, s, recovery) value:
 * `yParity` writes v as 0/1, `eip155` writes v as 35/36 and `compact` is the
 * 64-byte EIP-2098 form. A relayer can produce each of these from an honest
 * signature without the signer's key.
 */
export function reencodeSignature(
    signature: ethers.SignatureLike,
    encoding: SignatureEncoding
): string {
    const parsed = ethers.Signature.from(signature);
    switch (encoding) {
        case "yParity":
            return ethers.concat([
                parsed.r,
                parsed.s,
                ethers.toBeHex(parsed.yParity, 1)
            ]);
        case "eip155":
            return ethers.concat([
                parsed.r,
                parsed.s,
                ethers.toBeHex(35 + parsed.yParity, 1)
            ]);
        case "compact":
            return parsed.compactSerialized;
    }
}

/**
 * `count` distinct 65-byte encodings of one real signature, each writing v as
 * a different EIP-155 value (35 + yParity, 37 + yParity, ...). Every encoding
 * recovers to the same signer and is the same canonical signature.
 */
export function eip155Encodings(
    signature: ethers.SignatureLike,
    count: number
): string[] {
    const parsed = ethers.Signature.from(signature);
    return Array.from({ length: count }, (_, index) =>
        ethers.concat([
            parsed.r,
            parsed.s,
            ethers.toBeHex(35 + parsed.yParity + 2 * index, 1)
        ])
    );
}

/** Records every double-signature report until `stop` is called. */
export function recordDoubleSignatureReports() {
    const reports: DoubleSignatureReport[] = [];
    const stop = onDoubleSignature((report) => reports.push(report));
    return { reports, stop };
}

/** A random wallet's honest (RFC 6979) signature over a random 32-byte message. */
export async function signedMessage() {
    const wallet = ethers.Wallet.createRandom();
    const message = ethers.randomBytes(32);
    const signature = (await wallet.signMessage(message)) as Signature;
    return { wallet, message, signature };
}

/**
 * An honest signature plus a valid second signature by the same key over the
 * same message, made with a different nonce.
 */
export async function doubleSignedMessage() {
    const { wallet, message, signature } = await signedMessage();
    const second = signBlockVariant(
        wallet,
        ethers.hexlify(message),
        0
    ) as Signature;
    return { wallet, message, signature, second };
}
