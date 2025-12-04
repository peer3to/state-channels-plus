import { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

type DisputeHash = Hash;

export class DisputeFraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputefraudProofs: Map<Hash, DisputeFraudProofStruct> = new Map(); // key: fraudProofId
    private disputeHashToProofs: Map<DisputeHash, Set<Hash>> = new Map(); // participant -> set of fraud proof IDs

    constructor() {}

    // ====================================
    // CREATE
    // ====================================

    storeFraudProof(disputeFraudProof: DisputeFraudProofStruct): Hash {
        const proofHash = hash(disputeFraudProof.encodedProof);
        const disputeHash = hash(
            Codec.encode(disputeFraudProof.dispute, Type.Dispute)
        );
        // Store the fraud proof
        this.disputefraudProofs.set(proofHash, disputeFraudProof);

        // Index by dispute
        if (!this.disputeHashToProofs.has(disputeHash)) {
            this.disputeHashToProofs.set(disputeHash, new Set());
        }
        this.disputeHashToProofs.get(disputeHash)!.add(proofHash);

        return proofHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get all fraud proofs for a specific participant
     */
    getDisputeFraudProofForDispute(
        dispute: DisputeStruct
    ): DisputeFraudProofStruct | undefined {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const proofIds = this.disputeHashToProofs.get(disputeHash);
        if (!proofIds || proofIds.size === 0) {
            return undefined;
        }
        const firstId = proofIds.values().next().value;
        return this.disputefraudProofs.get(firstId!);
    }
}
