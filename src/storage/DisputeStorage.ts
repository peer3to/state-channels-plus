import { ethers } from "ethers";
import type {
    DisputeConfirmationStruct,
    DisputeStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

import type { ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type StoreOptions = {
    hash?: Hash;
};
type DidIDispute = boolean;

export class DisputeStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private readonly disputes: PersistentCollection<
        Hash,
        DisputeConfirmationStruct
    >;
    private readonly disputedForks: PersistentCollection<ForkId, DidIDispute>;

    constructor(controller?: PersistenceController) {
        this.disputes = new PersistentCollection("disputes", controller);
        this.disputedForks = new PersistentCollection(
            "disputedForks",
            controller
        );
    }

    // ====================================
    // CREATE
    // ====================================

    /*────────────────────────────────────────────────────────────────────────────
      STORE SIGNED DISPUTE
    ────────────────────────────────────────────────────────────────────────────*/
    public storeDispute(
        dispute: SignedDisputeStruct,
        options?: StoreOptions
    ): Hash {
        // Convert SignedDispute to DisputeConfirmation (empty signatures)
        return this.storeDisputeConfirmation(
            { signedDispute: dispute, signatures: [] },
            options
        );
    }

    public storeDisputedFork(forkId: ForkId, disputed: boolean): void {
        this.disputedForks.set(forkId, disputed);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE CONFIRMATION
    ────────────────────────────────────────────────────────────────────────────*/
    public storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        options?: StoreOptions
    ): Hash {
        // Determine hash - use provided or compute
        const disputeHash =
            options?.hash ??
            ethers.keccak256(disputeConfirmation.signedDispute.encodedDispute);
        this.disputes.update(disputeHash, (existing) => {
            if (!existing) {
                // If no existing dispute, store new dispute
                return disputeConfirmation;
            }
            if (
                !ethers.isBytesLike(
                    disputeConfirmation.signedDispute.encodedDispute
                ) ||
                ethers.hexlify(existing.signedDispute.encodedDispute) !==
                    ethers.hexlify(
                        disputeConfirmation.signedDispute.encodedDispute
                    ) ||
                ethers.hexlify(existing.signedDispute.signature) !==
                    ethers.hexlify(disputeConfirmation.signedDispute.signature)
            ) {
                throw new Error(
                    `Incompatible dispute confirmation for ${disputeHash}`
                );
            }

            // Merge signatures
            const signatures = new Set(existing.signatures.map(ethers.hexlify));
            for (const signature of disputeConfirmation.signatures) {
                signatures.add(ethers.hexlify(signature));
            }
            return {
                signedDispute: existing.signedDispute,
                signatures: [...signatures]
            };
        });
        return disputeHash;
    }

    // ====================================
    // READ
    // ====================================

    public getDisputeConfirmation(
        disputeHash: Hash
    ): DisputeConfirmationStruct | undefined {
        return this.disputes.get(disputeHash);
    }

    public getDispute(disputeHash: Hash): DisputeStruct | undefined {
        const confirmation = this.getDisputeConfirmation(disputeHash);
        return confirmation
            ? Codec.decode(
                  confirmation.signedDispute.encodedDispute,
                  Type.Dispute
              )
            : undefined;
    }

    public didIDispute(forkId: ForkId): DidIDispute {
        return this.disputedForks.get(forkId) ?? false;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================
}
