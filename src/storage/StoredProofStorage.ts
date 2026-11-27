import type { StoredProof } from "@/types/disputes";
import type { ForkId } from "@/types/types";

/**
 * The one state proof this node keeps: for its active fork only. A proof
 * stored for another fork replaces it (reset on a fork change). The value
 * is plain data with a `Codec` type (`Type.StoredProof`).
 */
export class StoredProofStorage {
    // at most one entry: the active fork's stored proof
    private readonly proofsByFork = new Map<ForkId, StoredProof>();

    /** Stores `proof` as the stored proof of `forkId`; drops the proof of any other fork. */
    public set(forkId: ForkId, proof: StoredProof): void {
        this.proofsByFork.clear();
        this.proofsByFork.set(forkId, proof);
    }

    /** The stored proof of `forkId`; none when another fork is active or nothing is stored. */
    public get(forkId: ForkId): StoredProof | undefined {
        return this.proofsByFork.get(forkId);
    }

    /** Drops the stored proof of `forkId`; a proof of another fork is kept. */
    public delete(forkId: ForkId): void {
        this.proofsByFork.delete(forkId);
    }
}
