// @spec-test-coverage-ignore: shared fixture builds real signature encodings; executable evidence belongs to its calling test declarations
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
