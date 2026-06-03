import type { BlockHeight, ChannelId, ForkId, Hash } from "@/types/types";
import type {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { SnapshotInterface } from "../interfaces/SnapshotInterface";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerSnapshotHandle implements SnapshotInterface {
    constructor(private readonly rpc: PeerCaller) {}

    queryStateSnapshotAt(req: { forkId: ForkId; height: BlockHeight }): Promise<
        | {
              hash: Hash;
              stateMachineStateHash: Hash;
              blockHeight: BlockHeight;
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.query.stateSnapshotAt, req) as Promise<
            | {
                  hash: Hash;
                  stateMachineStateHash: Hash;
                  blockHeight: BlockHeight;
              }
            | undefined
        >;
    }

    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash> {
        return this.rpc.call(
            ROUTES.query.stateSnapshotHashForFork,
            req
        ) as Promise<Hash>;
    }

    queryStateSnapshotByHash(
        hash: Hash
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call(ROUTES.query.stateSnapshotByHash, {
            hash
        }) as Promise<StateSnapshotStruct | undefined>;
    }

    queryStateSnapshotCount(): Promise<number> {
        return this.rpc.call(
            ROUTES.query.stateSnapshotCount,
            {}
        ) as Promise<number>;
    }

    queryGenesisSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call(ROUTES.query.genesisSnapshot, {
            forkId
        }) as Promise<StateSnapshotStruct | undefined>;
    }

    queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call(
            ROUTES.query.previousStateSnapshot,
            req
        ) as Promise<StateSnapshotStruct | undefined>;
    }

    queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call(ROUTES.query.lastMilestoneSnapshot, {
            forkId
        }) as Promise<StateSnapshotStruct | undefined>;
    }

    queryLocalStateSnapshot(
        channelId: ChannelId
    ): Promise<StateSnapshotStruct> {
        return this.rpc.call(ROUTES.dispute.localStateSnapshot, {
            channelId
        }) as Promise<StateSnapshotStruct>;
    }

    postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call(ROUTES.snapshot.post, { forkId }) as Promise<
            StateSnapshotStruct | undefined
        >;
    }

    prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshotStruct;
              milestoneSnapshots: StateSnapshotStruct[];
              milestoneProofs: MilestoneProofStruct[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.snapshot.prepareSameFork, {
            forkId
        }) as Promise<
            | {
                  callData: string[];
                  expectedSnapshot: StateSnapshotStruct;
                  milestoneSnapshots: StateSnapshotStruct[];
                  milestoneProofs: MilestoneProofStruct[];
                  outboundMessageBlocks: MessageBlockStruct[];
              }
            | undefined
        >;
    }
}
