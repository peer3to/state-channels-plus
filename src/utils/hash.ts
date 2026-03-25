import { ethers, BytesLike } from "ethers";

export const hash = ethers.keccak256;

export function bytes32LikeEqual(a: BytesLike, b: BytesLike): boolean {
    return ethers.hexlify(a) === ethers.hexlify(b);
}
