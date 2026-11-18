import type { Bytes, ChecksumAddress, Hash } from "@/types/types";

/** A contract storage slot index, 32 bytes. */
export type StorageSlot = Bytes;

/**
 * Checks contract storage against a state root the caller trusts. Each kind of
 * node proves storage in its own representation: one subclass per
 * representation.
 */
export default abstract class AStorageProofVerifier {
    /**
     * The 32-byte values of `slots` of the contract at `address` under
     * `stateRoot`, in the order of `slots`. A slot proven to hold nothing
     * reads as zero. Throws {@link StorageProofError} when `proofNodes` does
     * not prove every slot.
     */
    abstract provenStorage(
        stateRoot: Hash,
        address: ChecksumAddress,
        slots: StorageSlot[],
        proofNodes: Bytes[]
    ): string[];
}
