import { ForkId, Hash } from "@/types/types";

import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, hash, Type } from "@/utils";

type StoreOptions = {
    hash?: Hash;
};
type DidIDispute = boolean;

export class DisputeStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private disputes: Map<Hash, DisputeStruct>;
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
    storeDispute(dispute: DisputeStruct, options?: StoreOptions): Hash {
        const disputeHash =
            options?.hash ?? hash(Codec.encode(dispute, Type.Dispute));

        this.disputes.set(disputeHash, dispute);
        return disputeHash;
    }

    storeDisputedFork(forkId: ForkId, disputed: boolean): void {
        this.disputedForks.set(forkId, disputed);
    }

    // ====================================
    // READ
    // ====================================

    getDispute(disputeHash: Hash): DisputeStruct | undefined {
        return this.disputes.get(disputeHash);
    }

    didIDispute(forkId: ForkId): DidIDispute {
        return this.disputedForks.get(forkId) ?? false;
    }
}
