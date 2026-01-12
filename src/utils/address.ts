import { Address } from "@/types/types";
import { ethers } from "ethers";

export function getChecksumAddress(address: Address): string {
    return ethers.getAddress(address.toString());
}
