import { BlockHeight, ForkId } from "@/types/types";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { StateSnapshot } from "@/models";

export class TestAgreementManager {
    private proofs: Map<string, StateProofStruct> = new Map();
    private milestoneSnapshot: StateSnapshot | null = null;

    async getStateProof(
        forkId: ForkId,
        height: BlockHeight
    ): Promise<StateProofStruct> {
        const key = `${forkId}:${height}`;
        return this.proofs.get(key) || { milestones: [], signedBlocks: [] };
    }

    getSnapshotFromMilestone(_milestoneProof: any): StateSnapshot | null {
        return this.milestoneSnapshot;
    }

    // Builder pattern for test configuration
    withProof(options: {
        forkId: ForkId;
        height: BlockHeight;
        proof: StateProofStruct;
    }): this {
        const { forkId, height, proof } = options;
        this.proofs.set(`${forkId}:${height}`, proof);
        return this;
    }

    withMilestoneSnapshot(snapshot: StateSnapshot | null): this {
        this.milestoneSnapshot = snapshot;
        return this;
    }
}
