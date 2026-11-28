import SubstrateTrieProof from "./SubstrateTrieProof";
import AStorageProofVerifier, {
    type StorageSlot
} from "../AStorageProofVerifier";
import StorageProofError from "../StorageProofError";
import type { Bytes, ChecksumAddress, Hash } from "@/types/types";
import { blake2b } from "@noble/hashes/blake2b";
import { assertArgument, concat, getBytes, hexlify, ZeroHash } from "ethers";

/**
 * `twox128("EVM") ++ twox128("AccountStorages")`: where Frontier's pallet-evm
 * keeps every contract's storage in the chain's state trie.
 */
const ACCOUNT_STORAGES_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42";
const ADDRESS_LENGTH = 20;
const SLOT_LENGTH = 32;

/** Substrate's `Blake2_128Concat` map key hasher. */
function blake2_128Concat(key: Uint8Array): Uint8Array {
    return getBytes(concat([blake2b(key, { dkLen: 16 }), key]));
}

/**
 * Contract storage of a Frontier chain: pallet-evm's
 * `AccountStorages(address, slot)` map, proven by a Substrate read proof
 * against the state root of the Substrate header.
 */
export default class FrontierStorageProofVerifier extends AStorageProofVerifier {
    provenStorage(
        stateRoot: Hash,
        address: ChecksumAddress,
        slots: StorageSlot[],
        proofNodes: Bytes[]
    ): string[] {
        const addressBytes = getBytes(address);
        assertArgument(
            addressBytes.length === ADDRESS_LENGTH,
            "an address is 20 bytes",
            "address",
            address
        );
        const proof = new SubstrateTrieProof(proofNodes);
        const contractPrefix = concat([
            ACCOUNT_STORAGES_PREFIX,
            blake2_128Concat(addressBytes)
        ]);
        return slots.map((slot) => {
            const slotBytes = getBytes(slot);
            assertArgument(
                slotBytes.length === SLOT_LENGTH,
                "a storage slot is 32 bytes",
                "slots",
                slot
            );
            const value = proof.read(
                stateRoot,
                concat([contractPrefix, blake2_128Concat(slotBytes)])
            );
            // the map stores no entry for a zero slot
            if (value === null) return ZeroHash;
            if (value.length !== SLOT_LENGTH)
                throw new StorageProofError(
                    `The proof holds a ${value.length}-byte value for slot ${hexlify(slotBytes)}`
                );
            return hexlify(value);
        });
    }
}
