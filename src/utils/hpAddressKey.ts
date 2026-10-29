import type { HpAddress } from "@/types/types";
import { ethers } from "ethers";

/** The key a Hyperswarm public key is counted and indexed by: lowercase hex. */
export function hpAddressKey(publicKey: Uint8Array | string): HpAddress {
    return (
        typeof publicKey === "string" ? publicKey : ethers.hexlify(publicKey)
    ).toLowerCase();
}
