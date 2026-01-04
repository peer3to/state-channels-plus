import { ethers } from "@peer3/state-channels-plus";

export type Address = string;

export const DEFAULT_JOIN_AMOUNT = 500;
export const NEGOTIATION_TIMEOUT_MS = 20_000;

export const normalizeAddress = (addr: string): Address =>
    ethers.getAddress(addr);

export const compareAddresses = (a: Address, b: Address): number => {
    const aBig = BigInt(normalizeAddress(a));
    const bBig = BigInt(normalizeAddress(b));
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
};
