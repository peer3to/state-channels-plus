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

        const existing = this.fraudProofs.get(proofHash);
        if (existing) {
            return proofHash;
        }

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
    getFraudProofForParticipant(
        participant: Address
    ): FraudProofStruct | undefined {
        const proofIds = this.participantToProofs.get(participant);
        if (!proofIds || proofIds.size === 0) {
            return undefined;
        }
        const firstId = proofIds.values().next().value;
        return this.fraudProofs.get(firstId!);
    }

    getFraudProofByHash(proofHash: Hash): FraudProofStruct | undefined {
        return this.fraudProofs.get(proofHash);
    }
}
