import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import type { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

type DisputeHash = Hash;

export class DisputeFraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private readonly disputeFraudProofs: PersistentCollection<
        DisputeHash,
        "disputeFraudProofs"
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
        // a stored proof for the dispute is kept as is
        if (!this.disputeFraudProofs.has(disputeHash)) {
            this.disputeFraudProofs.set(disputeHash, disputeFraudProof);
        }
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
