import { ethers } from "ethers";

export function requireBytes32(
    value: string | undefined,
    message: string
): asserts value is string {
    if (!ethers.isHexString(value, 32)) throw new Error(message);
}
