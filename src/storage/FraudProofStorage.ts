import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import type { Address, Hash } from "@/types/types";
import { hash } from "@/utils";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export class FraudProofStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private readonly fraudProofs: PersistentCollection<Hash, FraudProofStruct>;
    private readonly participantToProofs = new Map<Address, Set<Hash>>();

    constructor(controller?: PersistenceController) {
        this.fraudProofs = new PersistentCollection(
            "fraudProofs",
            controller,
            () => this.rebuildIndexes()
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeFraudProof(fraudProof: FraudProofStruct): Hash {
        const proofHash = hash(fraudProof.encodedProof);
        // Store the fraud proof; a stored one is kept as is
        if (!this.fraudProofs.has(proofHash)) {
            this.fraudProofs.set(proofHash, fraudProof);
            this.indexProof(proofHash, fraudProof);
        }
        return proofHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get all fraud proofs for a specific participant, in insertion order
     */
    public getFraudProofsForParticipant(
        participant: Address
    ): FraudProofStruct[] {
        const proofIds =
            this.participantToProofs.get(
                String(participant).toLowerCase() as Address
            ) ?? [];
        return [...proofIds].map((id) => this.fraudProofs.get(id)!);
    }

    public getFraudProofByHash(proofHash: Hash): FraudProofStruct | undefined {
        return this.fraudProofs.get(proofHash);
    }

    // after a load, in store order
    private rebuildIndexes(): void {
        this.participantToProofs.clear();
        for (const [proofHash, proof] of this.fraudProofs.entries()) {
            this.indexProof(proofHash, proof);
        }
    }

    private indexProof(proofHash: Hash, proof: FraudProofStruct): void {
        const participant = String(proof.participant).toLowerCase() as Address;
        const hashes =
            this.participantToProofs.get(participant) ?? new Set<Hash>();
        hashes.add(proofHash);
        this.participantToProofs.set(participant, hashes);
    }
}
