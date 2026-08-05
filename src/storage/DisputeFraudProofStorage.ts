import { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

type DisputeHash = Hash;

export class DisputeFraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputeFraudProofs: Map<DisputeHash, DisputeFraudProofStruct> =
        new Map();

    constructor() {}

    // ====================================
    // PERSISTENCE
    // ====================================

    /** The persistence engine's view of this store's PRIMARY map. */
    *persistableEntries(): Iterable<[DisputeHash, DisputeFraudProofStruct]> {
        yield* this.disputeFraudProofs;
    }

    // ====================================
    // CREATE
    // ====================================

    storeFraudProof(disputeFraudProof: DisputeFraudProofStruct): Hash {
        const disputeHash = hash(
            Codec.encode(disputeFraudProof.dispute, Type.Dispute)
        );

        const existingProof = this.disputeFraudProofs.get(disputeHash);
        if (existingProof) {
            return disputeHash;
        }

        this.disputeFraudProofs.set(disputeHash, disputeFraudProof);

        return disputeHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get fraud proof for a specific dispute
     */
    getDisputeFraudProofForDispute(
        dispute: DisputeStruct
    ): DisputeFraudProofStruct | undefined {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        return this.disputeFraudProofs.get(disputeHash);
    }

    getDisputeFraudProofs(): DisputeFraudProofStruct[] {
        return [...this.disputeFraudProofs.values()];
    }
}
