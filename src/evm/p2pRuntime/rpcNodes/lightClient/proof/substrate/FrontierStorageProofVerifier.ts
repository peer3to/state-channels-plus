import { contractStorageKey } from "./frontierStateKeys";
import SubstrateTrieProof from "./SubstrateTrieProof";
import AStorageProofVerifier, {
    type StorageSlot
} from "../AStorageProofVerifier";
import StorageProofError from "../StorageProofError";
import type { Bytes, ChecksumAddress, Hash } from "@/types/types";
import { hexlify, ZeroHash } from "ethers";

const SLOT_LENGTH = 32;

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
        proofNodes: Bytes[] | SubstrateTrieProof
    ): string[] {
        return this.storageIn(
            SubstrateTrieProof.of(proofNodes),
            stateRoot,
            address,
            slots
        );
    }

    /** {@link provenStorage} from a proof the caller already holds. */
    storageIn(
        proof: SubstrateTrieProof,
        stateRoot: Hash,
        address: ChecksumAddress,
        slots: StorageSlot[]
    ): string[] {
        const keys = slots.map((slot) => contractStorageKey(address, slot));
        return keys.map((key, index) => {
            const value = proof.read(stateRoot, key);
            // the map stores no entry for a zero slot
            if (value === null) return ZeroHash;
            if (value.length !== SLOT_LENGTH)
                throw new StorageProofError(
                    `The proof holds a ${value.length}-byte value for slot ${hexlify(slots[index])}`
                );
            return hexlify(value);
        });
    }
}
