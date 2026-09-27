// @spec-test-coverage-ignore: shared fixture builds signature encodings; executable evidence belongs to its calling test declarations
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
