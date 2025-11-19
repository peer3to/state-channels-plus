import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { ExitPointsStorage } from "./ExitPointsStorage";
import { QueueStorage } from "./QueueStorage";
import { DisputeStorage } from "./DisputeStorage";
import { FraudProofStorage } from "./FraudProofStorage";

import { BlockCoordinates, StateSnapshot } from "@/models";
import { deepCopyProxy } from "@/utils";
import { ForkId, Bytes, BlockOrSnapshot } from "@/types/types";
import { Address } from "@/types/types";
import { TimeoutStorage } from "./TimeoutStorage";
import { ForceExitStorage } from "./ForceExitStorage";
import { DisputeFraudProofStorage } from "./DisputeFraudProofStorage";
import { BlockCalldataStorage } from "./BlockCalldataStorage";

export class Storage {
    public readonly blocks: BlockStorage;
    public readonly joinChannelBlocks: JoinChannelBlockStorage;
    public readonly exitChannelBlocks: ExitChannelBlockStorage;
    public readonly stateSnapshots: StateSnapshotStorage;
    public readonly stateMachineStates: StateMachineStateStorage;
    public readonly exitPoints: ExitPointsStorage;
    public readonly queues: QueueStorage;
    public readonly disputes: DisputeStorage;
    public readonly fraudProofs: FraudProofStorage;
    public readonly disputeFraudProofs: DisputeFraudProofStorage;
    public readonly timeout: TimeoutStorage;
    public readonly forceExit: ForceExitStorage;
    public readonly blockCalldata: BlockCalldataStorage;

    constructor() {
        this.blocks = deepCopyProxy(new BlockStorage());
        this.joinChannelBlocks = deepCopyProxy(new JoinChannelBlockStorage());
        this.exitChannelBlocks = deepCopyProxy(new ExitChannelBlockStorage());
        this.stateSnapshots = deepCopyProxy(new StateSnapshotStorage());
        this.stateMachineStates = deepCopyProxy(new StateMachineStateStorage());
        this.exitPoints = deepCopyProxy(new ExitPointsStorage());
        this.queues = deepCopyProxy(new QueueStorage());
        this.disputes = deepCopyProxy(new DisputeStorage());
        this.fraudProofs = deepCopyProxy(new FraudProofStorage());
        this.disputeFraudProofs = deepCopyProxy(new DisputeFraudProofStorage());
        this.timeout = deepCopyProxy(new TimeoutStorage());
        this.forceExit = deepCopyProxy(new ForceExitStorage());
        this.blockCalldata = deepCopyProxy(new BlockCalldataStorage());
        return deepCopyProxy(this);
    }

    /**
     * Get the state snapshot for given block coordinates.
     *
     * If height < 0 (previous to first block): returns the genesis state snapshot of that fork
     * If height >= 0: gets the state snapshot from that block height
     *
     */
    getStateSnapshot(coordinates: BlockCoordinates): StateSnapshot | undefined {
        const { forkId, height } = coordinates;

        if (height <= 0) {
            return this.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        }

        const block = this.blocks.getBlock(forkId, height);
        if (!block) {
            return undefined;
        }

        const stateSnapshotHash = block.stateSnapshotHash;

        return this.stateSnapshots.getStateSnapshotByHash(stateSnapshotHash);
    }

    getGenesisStateMachineState(forkId: ForkId): Bytes | undefined {
        const genesisSnapshot =
            this.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot) {
            return undefined;
        }
        const stateMachineStateHash =
            genesisSnapshot.snapshotData.stateMachineStateHash;

        return this.stateMachineStates.getStateMachineState(
            stateMachineStateHash
        );
    }

    getPreviousStateSnapshot(
        coordinates: BlockCoordinates
    ): StateSnapshot | undefined {
        return this.getStateSnapshot({
            forkId: coordinates.forkId,
            height: coordinates.height - 1
        });
    }

    getParticipants(coordinates: BlockCoordinates): Address[] {
        const previousSnapshot = this.getPreviousStateSnapshot(coordinates);
        if (!previousSnapshot || !previousSnapshot.snapshotData.participants) {
            return [];
        }
        return previousSnapshot.snapshotData.participants;
    }

    getPreviousBlockOrSnapshot(coordinates: BlockCoordinates): BlockOrSnapshot {
        const { forkId, height } = coordinates;

        if (height > 0) {
            const prevBlock = this.blocks.getBlock(forkId, height - 1)!;

            return { block: prevBlock };
        }

        const genesisSnapshot =
            this.stateSnapshots.getGenesisSnapshotDataByForkId(forkId)!;
        return { stateSnapshot: genesisSnapshot };
    }

    getPreviousRelevantTimestamp(
        coordinates: BlockCoordinates,
        participantAddress: Address
    ): number {
        const previousBlockOrSnapshot =
            this.getPreviousBlockOrSnapshot(coordinates);

        if (previousBlockOrSnapshot.block) {
            return previousBlockOrSnapshot.block.getRelevantTimestamp(
                participantAddress
            );
        }

        return previousBlockOrSnapshot.stateSnapshot!.timestamp;
    }
}
