import { type BytesLike, ethers, hexlify, zeroPadValue } from "ethers";

export function requireBytes32(
    value: string | undefined,
    message: string
): asserts value is string {
    if (!ethers.isHexString(value, 32)) throw new Error(message);
}

/** The log topic an indexed argument is: its value left-padded to 32 bytes. */
export function indexedTopic(value: BytesLike): string {
    return zeroPadValue(hexlify(value), 32);
}
