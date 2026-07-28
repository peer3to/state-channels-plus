import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

import type { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type DisputeHash = Hash;

export class DisputeFraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private readonly disputeFraudProofs: PersistentCollection<
        DisputeHash,
        DisputeFraudProofStruct
    >;

    constructor(controller?: PersistenceController) {
        this.disputeFraudProofs = new PersistentCollection(
            "disputeFraudProofs",
            controller
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeFraudProof(disputeFraudProof: DisputeFraudProofStruct): Hash {
        const disputeHash = hash(
            Codec.encode(disputeFraudProof.dispute, Type.Dispute)
        );
        this.disputeFraudProofs.update(disputeHash, (existing) => {
            if (existing) {
                if (
                    String(existing.proofType) !==
                        String(disputeFraudProof.proofType) ||
                    String(existing.participant).toLowerCase() !==
                        String(disputeFraudProof.participant).toLowerCase() ||
                    String(existing.encodedProof) !==
                        String(disputeFraudProof.encodedProof)
                ) {
                    throw new Error(
                        `Incompatible dispute fraud proof for ${disputeHash}`
                    );
                }
                return existing;
            }
            return disputeFraudProof;
        });
        return disputeHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get fraud proof for a specific dispute
     */
    public getDisputeFraudProofForDispute(
        dispute: DisputeStruct
    ): DisputeFraudProofStruct | undefined {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        return this.disputeFraudProofs.get(disputeHash);
    }

    public getDisputeFraudProofs(): DisputeFraudProofStruct[] {
        return [...this.disputeFraudProofs.values()];
    }
}
