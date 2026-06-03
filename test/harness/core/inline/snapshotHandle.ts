import { ZeroHash } from "ethers";
import type { BlockHeight, ForkId, Hash } from "@/types/types";
import type {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { SnapshotInterface } from "../interfaces/SnapshotInterface";
import type { TestPeer } from "../types";
import { BlockCoordinates } from "@/models";

export class InlineSnapshotHandle implements SnapshotInterface {
    constructor(private readonly peer: TestPeer) {}

    async queryStateSnapshotAt(req: BlockCoordinates): Promise<
        | {
              hash: Hash;
              stateMachineStateHash: Hash;
              blockHeight: BlockHeight;
          }
        | undefined
    > {
        return this.peer.stateManager.storage.getStateSnapshot(req);
    }

    async queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash> {
        const storage = this.peer.stateManager.storage;
        if (req.previousBlockHash) {
            const block = storage.blocks.getBlock(req.previousBlockHash);
            if (block) return block.stateSnapshotHash;
        }
        const genesis = storage.stateSnapshots.getGenesisSnapshotByForkId(
            req.forkId
        );
        return genesis?.hash ?? ZeroHash;
    }

    async queryStateSnapshotByHash(
        hash: Hash
    ): Promise<StateSnapshotStruct | undefined> {
        const snapshot =
            this.peer.stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                hash
            );
        return snapshot?.toStruct();
    }

    async queryStateSnapshotCount(): Promise<number> {
        // snapshotsByHash is private on StateSnapshotStorage; reach in for the count
        const snaps = this.peer.stateManager.storage
            .stateSnapshots as unknown as {
            snapshotsByHash: Map<unknown, unknown>;
        };
        return snaps.snapshotsByHash.size;
    }

    async queryGenesisSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        const genesis =
            this.peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            );
        return genesis?.toStruct();
    }

    async queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | undefined> {
        const snapshot =
            this.peer.stateManager.storage.getPreviousStateSnapshot(req);
        return snapshot?.toStruct();
    }

    async queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        const result =
            await this.peer.stateManager.prepareUpdateSnapshotSameFork(forkId);
        return result?.milestoneSnapshots.at(-1)?.toStruct();
    }

    async queryLocalStateSnapshot(
        channelId: string
    ): Promise<StateSnapshotStruct> {
        return await this.peer.stateManager.diamondStateMachine.localDiamondContract.getStateSnapshot(
            channelId
        );
    }

    async postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        const result = await this.peer.stateManager.postStateSnapshot(forkId);
        return result?.toStruct();
    }

    async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshotStruct;
              milestoneSnapshots: StateSnapshotStruct[];
              milestoneProofs: MilestoneProofStruct[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        const result =
            await this.peer.stateManager.prepareUpdateSnapshotSameFork(forkId);
        if (!result) return undefined;
        return {
            callData: result.callData,
            expectedSnapshot: result.expectedSnapshot.toStruct(),
            milestoneSnapshots: result.milestoneSnapshots.map((s) =>
                s.toStruct()
            ),
            milestoneProofs: result.milestoneProofs,
            outboundMessageBlocks: result.outboundMessageBlocks
        };
    }
}
