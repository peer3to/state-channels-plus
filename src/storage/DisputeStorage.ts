import { ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import {
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers } from "ethers";

// Where a stored dispute confirmation copy came from.
export enum DisputeConfirmationOrigin {
    // A `DisputeCommitted` event: the chain accepted this copy.
    CHAIN_EVENT,
    // A peer's spectate-sync payload: nothing verifies its signatures.
    SYNC
}

type StoreOptions = {
    origin: DisputeConfirmationOrigin;
};
type DidIDispute = boolean;
type StoredDisputeConfirmation = {
    disputeConfirmation: DisputeConfirmationStruct;
    origin: DisputeConfirmationOrigin;
};

export class DisputeStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputes: Map<Hash, StoredDisputeConfirmation>;
    private disputedForks: Map<ForkId, DidIDispute>;

    constructor() {
        this.disputes = new Map();
        this.disputedForks = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeDisputedFork(forkId: ForkId, disputed: boolean): void {
        this.disputedForks.set(forkId, disputed);
    }

    /*────────────────────────────────────────────────────────────────────────────
      STORE DISPUTE CONFIRMATION
    ────────────────────────────────────────────────────────────────────────────*/
    storeDisputeConfirmation(
        disputeConfirmation: DisputeConfirmationStruct,
        options: StoreOptions
    ): Hash {
        const disputeHash = ethers.keccak256(
            disputeConfirmation.signedDispute.encodedDispute
        );

        // Keep the first stored copy; never merge signatures. Only a chain
        // event copy replaces a stored sync copy (REQ-DSTORE-1).
        const existing = this.disputes.get(disputeHash);
        const replacesSyncCopy =
            existing?.origin === DisputeConfirmationOrigin.SYNC &&
            options.origin === DisputeConfirmationOrigin.CHAIN_EVENT;
        if (existing === undefined || replacesSyncCopy) {
            this.disputes.set(disputeHash, {
                disputeConfirmation,
                origin: options.origin
            });
        }
        return disputeHash;
    }

    // ====================================
    // READ
    // ====================================

    getDisputeConfirmation(
        disputeHash: Hash
    ): DisputeConfirmationStruct | undefined {
        return this.disputes.get(disputeHash)?.disputeConfirmation;
    }

    getDispute(disputeHash: Hash): DisputeStruct | undefined {
        const disputeConfirmation = this.getDisputeConfirmation(disputeHash);
        return disputeConfirmation
            ? Codec.decode(
                  disputeConfirmation.signedDispute.encodedDispute,
                  Type.Dispute
              )
            : undefined;
    }

    didIDispute(forkId: ForkId): DidIDispute {
        return this.disputedForks.get(forkId) ?? false;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================
}
