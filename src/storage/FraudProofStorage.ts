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
    private readonly fraudProofs: PersistentCollection<Hash, "fraudProofs">; // key: fraudProofId
    private readonly participantToProofs = new Map<Address, Set<Hash>>(); // lowercased participant -> set of fraud proof IDs, in store order

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
        if (this.fraudProofs.has(proofHash)) {
            return proofHash;
        }

        this.fraudProofs.set(proofHash, fraudProof);
        this.indexProof(proofHash, fraudProof);

        return proofHash;
    }

    // ====================================
    // READ
    // ====================================

    /**
     * Get all fraud proofs for a specific participant
     */
    public getFraudProofForParticipant(
        participant: Address
    ): FraudProofStruct | undefined {
        const proofIds = this.participantToProofs.get(
            this.participantKey(participant)
        );
        const firstId = proofIds?.values().next().value;
        return firstId ? this.fraudProofs.get(firstId) : undefined;
    }

    public getFraudProofByHash(proofHash: Hash): FraudProofStruct | undefined {
        return this.fraudProofs.get(proofHash);
    }

    private indexProof(proofHash: Hash, proof: FraudProofStruct): void {
        const participant = this.participantKey(proof.participant);
        const hashes =
            this.participantToProofs.get(participant) ?? new Set<Hash>();
        hashes.add(proofHash);
        this.participantToProofs.set(participant, hashes);
    }

    private participantKey(participant: FraudProofStruct["participant"]) {
        return String(participant).toLowerCase() as Address;
    }

    // after a load, in store order
    private rebuildIndexes(): void {
        this.participantToProofs.clear();
        for (const [proofHash, proof] of this.fraudProofs.entries()) {
            this.indexProof(proofHash, proof);
        }
    }
}
