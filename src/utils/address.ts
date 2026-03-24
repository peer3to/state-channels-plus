import { Address } from "@/types/types";
import { ethers } from "ethers";

export function getChecksumAddress(address: Address): string {
    return ethers.getAddress(address.toString());
}

export function addressesEqual(a: Address, b: Address): boolean {
    return getChecksumAddress(a) === getChecksumAddress(b);
}
