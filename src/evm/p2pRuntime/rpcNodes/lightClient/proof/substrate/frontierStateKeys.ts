import type { Bytes, ChecksumAddress } from "@/types/types";
import { blake2b } from "@noble/hashes/blake2b";
import { assertArgument, concat, getBytes } from "ethers";

/**
 * `twox128("EVM") ++ twox128("AccountStorages")`: where Frontier's pallet-evm
 * keeps every contract's storage in the chain's state trie.
 */
const ACCOUNT_STORAGES_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42";
/** `twox128("EVM") ++ twox128("AccountCodes")`: pallet-evm's contract code. */
const ACCOUNT_CODES_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ea70f53d5a3306ce02aaf97049cf181a";
/** `twox128("System") ++ twox128("Account")`: every account's nonce and balances. */
const SYSTEM_ACCOUNT_PREFIX =
    "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9";
/**
 * `twox128("Ethereum") ++ twox128("CurrentBlock")`: the Ethereum block
 * pallet-ethereum built in the Substrate block.
 */
export const CURRENT_ETHEREUM_BLOCK_KEY =
    "0x2013754dd003840aea66b349f8241e25c8c156f8164e0465c74b8972ea68b4b3";
const ADDRESS_LENGTH = 20;
const SLOT_LENGTH = 32;

/** Substrate's `Blake2_128Concat` map key hasher. */
function blake2_128Concat(key: Uint8Array): Uint8Array {
    return getBytes(concat([blake2b(key, { dkLen: 16 }), key]));
}

function addressKey(address: ChecksumAddress): Uint8Array {
    const addressBytes = getBytes(address);
    assertArgument(
        addressBytes.length === ADDRESS_LENGTH,
        "an address is 20 bytes",
        "address",
        address
    );
    return blake2_128Concat(addressBytes);
}

/** The trie key of `AccountStorages(address, slot)`. */
export function contractStorageKey(
    address: ChecksumAddress,
    slot: Bytes
): string {
    const slotBytes = getBytes(slot);
    assertArgument(
        slotBytes.length === SLOT_LENGTH,
        "a storage slot is 32 bytes",
        "slot",
        slot
    );
    return concat([
        ACCOUNT_STORAGES_PREFIX,
        addressKey(address),
        blake2_128Concat(slotBytes)
    ]);
}

/** The trie key of `AccountCodes(address)`. */
export function accountCodeKey(address: ChecksumAddress): string {
    return concat([ACCOUNT_CODES_PREFIX, addressKey(address)]);
}

/**
 * The trie key of `System.Account` of `address`. The chain must map an
 * address to the account of the same 20 bytes (`IdentityAddressMapping`).
 */
export function systemAccountKey(address: ChecksumAddress): string {
    return concat([SYSTEM_ACCOUNT_PREFIX, addressKey(address)]);
}
