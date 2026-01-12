import { getChecksumAddress } from "@/utils";

export type Address = string;

export const DEFAULT_JOIN_AMOUNT = 500;
export const NEGOTIATION_TIMEOUT_MS = 20_000;

export const compareAddresses = (a: Address, b: Address): number => {
    const aBig = BigInt(getChecksumAddress(a));
    const bBig = BigInt(getChecksumAddress(b));
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
};
