import { Address, Hash } from "@/types/types";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { hash } from "@/utils";

export class FraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private fraudProofs: Map<Hash, FraudProofStruct> = new Map(); // key: fraudProofId
    private participantToProofs: Map<Address, Set<Hash>> = new Map(); // participant -> set of fraud proof IDs

    constructor() {}

    // ====================================
    // CREATE
    // ====================================

    storeFraudProof(fraudProof: FraudProofStruct): Hash {
        const proofHash = hash(fraudProof.encodedProof);

        // Store the fraud proof
        this.fraudProofs.set(proofHash, fraudProof);

        // Index by participant
        if (!this.participantToProofs.has(fraudProof.participant)) {
            this.participantToProofs.set(fraudProof.participant, new Set());
        }
        this.participantToProofs.get(fraudProof.participant)!.add(proofHash);

        return proofHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get all fraud proofs for a specific participant
     */
    getFraudProofsForParticipant(participant: Address): FraudProofStruct[] {
        const proofIds = this.participantToProofs.get(participant);
        if (!proofIds) {
            return [];
        }

        return Array.from(proofIds)
            .map((proofId) => this.fraudProofs.get(proofId))
            .filter((p) => !!p);
    }
}
