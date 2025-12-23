import { BlockHeight, ForkId } from "@/types/types";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { StateSnapshot } from "@/models";
import AgreementManager from "@/agreementManager/AgreementManager";
import Storage from "@/storage";
import { getGlobalLogger, Logger } from "@/utils/logging";

/**
 * test mock of AgreementManager
 * for UNIT testing of StateManager
 */
export class TestAgreementManager extends AgreementManager {
    private proofs: Map<string, StateProofStruct> = new Map();
    private milestoneSnapshot: StateSnapshot | undefined = undefined;

    constructor(storage: Storage, logger?: Logger) {
        super(
            storage,
            logger ||
                getGlobalLogger().child({ component: "TestAgreementManager" })
        );
    }

    // Override getStateProof to return configured test proofs
    async getStateProof(
        forkId: ForkId,
        height: BlockHeight
    ): Promise<StateProofStruct> {
        const key = `${forkId}:${height}`;
        return this.proofs.get(key) || { milestones: [], signedBlocks: [] };
    }

    // Override getSnapshotFromMilestone to return configured test snapshot
    getSnapshotFromMilestone(_milestoneProof: any): StateSnapshot | undefined {
        return this.milestoneSnapshot ?? undefined;
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

    withMilestoneSnapshot(snapshot: StateSnapshot | undefined): this {
        this.milestoneSnapshot = snapshot;
        return this;
    }
}
