// @spec-test-coverage-ignore: shared fixture builds real signatures and their encodings; executable evidence belongs to its calling test declarations
import { signBlockVariant } from "./QueueAdmissionFixture";
import { signedMessage } from "./RecoveryCacheFixture";
import { DoubleSignatureReport, onDoubleSignature } from "@/cache";
import { Signature } from "@/types/types";
import { ethers } from "ethers";

// secp256k1 group order.
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const word = (value: bigint) => ethers.toBeHex(value, 32);

/**
 * Re-encodings of one real 65-byte signature that ethers still recovers (or
 * that are malformed) but OpenZeppelin's `ECDSA.tryRecover(bytes32, bytes)`
 * rejects: what a Byzantine author can send without re-signing.
 */
export function contractRejectedEncodings(
    signature: string
): Record<string, string> {
    const sig = ethers.Signature.from(signature);
    const v = ethers.toBeHex(sig.v, 1);
    const withV = (value: number) =>
        ethers.concat([sig.r, sig.s, ethers.toBeHex(value, 1)]);
    return {
        "compact 64-byte": sig.compactSerialized,
        "v of 0/1": withV(sig.v - 27),
        "EIP-155 v": withV(sig.v - 27 + 37),
        "high s": ethers.concat([
            sig.r,
            word(N - BigInt(sig.s)),
            ethers.toBeHex(sig.v === 27 ? 28 : 27, 1)
        ]),
        "zero r": ethers.concat([word(0n), sig.s, v]),
        "zero s": ethers.concat([sig.r, word(0n), v]),
        "r at the group order": ethers.concat([word(N), sig.s, v]),
        "66 bytes": ethers.concat([sig.serialized, "0x00"]),
        "63 bytes": ethers.dataSlice(sig.serialized, 0, 63),
        empty: "0x"
    };
}

/**
 * One real signature over `keccak256(encodedData)`, the digest blocks are
 * signed over, in every encoding a Byzantine peer could send: the ordinary
 * one and each of `contractRejectedEncodings`.
 */
export async function signedDigestEncodings(): Promise<{
    wallet: ethers.HDNodeWallet;
    encodedData: string;
    digest: Uint8Array;
    cases: Record<string, string>;
}> {
    const wallet = ethers.Wallet.createRandom();
    const encodedData = ethers.hexlify(ethers.randomBytes(96));
    const digest = ethers.getBytes(ethers.keccak256(encodedData));
    const signature = await wallet.signMessage(digest);
    const cases: Record<string, string> = {
        ordinary: signature,
        ...contractRejectedEncodings(signature)
    };
    return { wallet, encodedData, digest, cases };
}

/**
 * Byte encodings that ethers recovers to the same signer as the 65-byte v
 * 27/28 form; the contracts reject each of them.
 */
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

/** Records every double-signature report until `stop` is called. */
export function recordDoubleSignatureReports() {
    const reports: DoubleSignatureReport[] = [];
    const stop = onDoubleSignature((report) => reports.push(report));
    return { reports, stop };
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
