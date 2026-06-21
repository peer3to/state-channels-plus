import { Address } from "@/types/types";
import { Address as EthereumJsAddress } from "@ethereumjs/util";
import { ethers } from "ethers";

export type EthereumJsEvmAddress = EthereumJsAddress;

/** Convert any address-like value into a lowercased ethereumjs EVM `Address`. */
export function toEthereumJsEvmAddress(
    address: EthereumJsEvmAddress | Address | string
): EthereumJsEvmAddress {
    return EthereumJsAddress.fromString(address.toString().toLowerCase());
}

export function getChecksumAddress(address: Address): string {
    return ethers.getAddress(address.toString());
}

export function addressesEqual(a: Address, b: Address): boolean {
    return getChecksumAddress(a) === getChecksumAddress(b);
}
