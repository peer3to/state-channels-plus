import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

import type { Address, Hash } from "@/types/types";
import { hash } from "@/utils";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

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
        this.fraudProofs.update(proofHash, (existing) => {
            if (
                existing &&
                (String(existing.proofType) !== String(fraudProof.proofType) ||
                    String(existing.participant).toLowerCase() !==
                        String(fraudProof.participant).toLowerCase())
            ) {
                throw new Error(`Incompatible fraud proof for ${proofHash}`);
            }

            // Store the fraud proof
            return fraudProof;
        });
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
            String(participant).toLowerCase() as Address
        );
        const firstId = proofIds?.values().next().value;
        return firstId ? this.fraudProofs.get(firstId) : undefined;
    }

    public getFraudProofByHash(proofHash: Hash): FraudProofStruct | undefined {
        return this.fraudProofs.get(proofHash);
    }

    public rebuildIndexes(): void {
        this.participantToProofs.clear();
        for (const [proofHash, proof] of this.fraudProofs.entries()) {
            const participant = String(
                proof.participant
            ).toLowerCase() as Address;
            const hashes =
                this.participantToProofs.get(participant) ?? new Set<Hash>();
            hashes.add(proofHash);
            this.participantToProofs.set(participant, hashes);
        }
    }
}
