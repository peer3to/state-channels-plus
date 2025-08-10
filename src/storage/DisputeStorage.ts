import { ForkId, Hash } from "@/types/types";
import { ethers } from "ethers";
import {
    DisputeConfirmationStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

type StoreOptions = {
    hash?: Hash;
};
type DidIDispute = boolean;

export class DisputeStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputes: Map<Hash, DisputeConfirmationStruct>;
    private disputedForks: Map<ForkId, DidIDispute>;

    constructor() {
        this.disputes = new Map();
        this.disputedForks = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      STORE  DISPUTE 
    ────────────────────────────────────────────────────────────────────────────*/
    storeDispute(dispute: SignedDisputeStruct, options?: StoreOptions): Hash {
        // Convert SignedDispute to DisputeConfirmation (empty signatures)
        const disputeConfirmation: DisputeConfirmationStruct = {
            signedDispute: dispute,
            signatures: [] // Starts empty, ready for peer confirmations
        };

        return this._storeDisputeConfirmationWithOptions(
            disputeConfirmation,
            options
        );
    }

    storeDisputedFork(forkId: ForkId, disputed: boolean): void {
        this.disputedForks.set(forkId, disputed);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE CONFIRMATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        options?: StoreOptions
    ): Hash {
        return this._storeDisputeConfirmationWithOptions(
            disputeConfirmation,
            options
        );
    }

    // ====================================
    // READ
    // ====================================

    getDisputeConfirmation(
        disputeHash: Hash
    ): DisputeConfirmationStruct | undefined {
        return this.disputes.get(disputeHash);
    }

    getDisputedFork(forkId: ForkId): DidIDispute {
        return this.disputedForks.get(forkId) ?? false;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private _storeDisputeConfirmationWithOptions(
        disputeConfirmation: DisputeConfirmationStruct,
        options?: StoreOptions
    ): Hash {
        // Determine hash - use provided or compute
        const disputeHash =
            options?.hash ??
            ethers.keccak256(disputeConfirmation.signedDispute.encodedDispute);

        const existingDispute = this.disputes.get(disputeHash);

        if (existingDispute !== undefined) {
            // Merge signatures
            const signaturesSet = new Set(existingDispute.signatures);
            for (const newSignature of disputeConfirmation.signatures) {
                signaturesSet.add(newSignature);
            }

            const mergedDispute: DisputeConfirmationStruct = {
                signedDispute: existingDispute.signedDispute,
                signatures: Array.from(signaturesSet)
            };

            this.disputes.set(disputeHash, mergedDispute);
            return disputeHash;
        }
        // If no existing dispute, store new dispute

        this.disputes.set(disputeHash, disputeConfirmation);
        return disputeHash;
    }
}
