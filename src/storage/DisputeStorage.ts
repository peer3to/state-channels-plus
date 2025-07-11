import { Hash } from "@/types/types";
import { ethers } from "ethers";
import {
    DisputeConfirmationStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

export class DisputeStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputes: Map<Hash, DisputeConfirmationStruct>;

    constructor() {
        this.disputes = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** Insert signed block with auto-computed keys */
    storeDispute(dispute: SignedDisputeStruct): Hash;

    /** Insert signed block with provided keys */
    storeDispute(dispute: SignedDisputeStruct, disputeHash: Hash): Hash;

    /*────────────────────────────────────────────────────────────────────────────
      STORE  DISPUTE - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeDispute(dispute: SignedDisputeStruct, disputeHash?: Hash): Hash {
        // Convert SignedDispute to DisputeConfirmation (empty signatures)
        const disputeConfirmation: DisputeConfirmationStruct = {
            signedDispute: dispute,
            signatures: [] // Starts empty, ready for peer confirmations
        };

        return disputeHash !== undefined
            ? this._storeDisputeWithHash(disputeConfirmation, disputeHash)
            : this._storeDispute(disputeConfirmation);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE CONFIRMATION - OVERLOAD SIGNATURES
    ────────────────────────────────────────────────────────────────────────────*/

    /** Insert block confirmation with auto-computed keys */
    storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct
    ): Hash;

    /** Insert block confirmation with provided keys */
    storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        disputeHash: Hash
    ): Hash;

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE CONFIRMATION - IMPLEMENTATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        disputeHash?: Hash
    ): Hash {
        return disputeHash !== undefined
            ? this._storeDisputeWithHash(disputeConfirmation, disputeHash)
            : this._storeDispute(disputeConfirmation);
    }

    // ====================================
    // READ
    // ====================================

    getDisputeConfirmation(
        disputeHash: Hash
    ): DisputeConfirmationStruct | undefined {
        return this.disputes.get(disputeHash);
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private _storeDispute(
        disputeConfirmation: DisputeConfirmationStruct
    ): Hash {
        const disputeHash = ethers.keccak256(
            disputeConfirmation.signedDispute.encodedDispute
        );

        return this._storeDisputeWithHash(disputeConfirmation, disputeHash);
    }

    private _storeDisputeWithHash(
        disputeConfirmation: DisputeConfirmationStruct,
        disputeHash: Hash
    ): Hash {
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
        // If no existing block, store new block

        this.disputes.set(disputeHash, disputeConfirmation);
        return disputeHash;
    }
}
