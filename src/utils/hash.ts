import { ethers } from "ethers";

export const hash = ethers.keccak256;

/** Compare bytes32-like values (hex string, Uint8Array, etc.) after canonical hex normalization. */
export function bytes32LikeEqual(
    a: ethers.BytesLike,
    b: ethers.BytesLike
): boolean {
    return ethers.hexlify(a) === ethers.hexlify(b);
}
