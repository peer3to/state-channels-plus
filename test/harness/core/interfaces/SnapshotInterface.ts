import type { BlockHeight, ForkId, Hash } from "@/types/types";
import type {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export type PrepareUpdateSnapshotSameForkResult = {
    callData: string[];
    expectedSnapshot: StateSnapshotStruct;
    milestoneSnapshots: StateSnapshotStruct[];
    milestoneProofs: MilestoneProofStruct[];
    outboundMessageBlocks: MessageBlockStruct[];
};

export interface SnapshotInterface {
    // --- reads: by coordinates / hash ---

    queryStateSnapshotAt(req: { forkId: ForkId; height: BlockHeight }): Promise<
        | {
              hash: Hash;
              stateMachineStateHash: Hash;
              blockHeight: BlockHeight;
          }
        | undefined
    >;

    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash>;

    queryStateSnapshotByHash(
        hash: Hash
    ): Promise<StateSnapshotStruct | undefined>;

    queryStateSnapshotCount(): Promise<number>;

    // --- reads: genesis, history, milestone ---

    queryGenesisSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined>;

    queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | undefined>;

    queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined>;

    // --- reads: on-chain view ---

    queryLocalStateSnapshot(channelId: string): Promise<StateSnapshotStruct>;

    // --- writes ---

    postStateSnapshot(forkId: ForkId): Promise<StateSnapshotStruct | undefined>;

    prepareUpdateSnapshotSameFork(
        forkId: ForkId
    ): Promise<PrepareUpdateSnapshotSameForkResult | undefined>;
}
