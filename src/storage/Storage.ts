import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { ExitPointsStorage } from "./ExitPointsStorage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { deepCopyProxy } from "@/utils";
import { ForkId, Bytes } from "@/types/types";

export class Storage {
    public readonly blocks: BlockStorage;
    public readonly joinChannelBlocks: JoinChannelBlockStorage;
    public readonly exitChannelBlocks: ExitChannelBlockStorage;
    public readonly stateSnapshots: StateSnapshotStorage;
    public readonly stateMachineStates: StateMachineStateStorage;
    public readonly exitPoints: ExitPointsStorage;

    constructor() {
        this.blocks = deepCopyProxy(new BlockStorage());
        this.joinChannelBlocks = deepCopyProxy(new JoinChannelBlockStorage());
        this.exitChannelBlocks = deepCopyProxy(new ExitChannelBlockStorage());
        this.stateSnapshots = deepCopyProxy(new StateSnapshotStorage());
        this.stateMachineStates = deepCopyProxy(new StateMachineStateStorage());
        this.exitPoints = deepCopyProxy(new ExitPointsStorage());
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

        if (height < 0) {
            return this.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        }

        const blockEntry = this.blocks.getBlockEntry(forkId, height);
        if (!blockEntry) {
            return undefined;
        }

        const stateSnapshotHash = Block.decode(
            blockEntry.blockConfirmation.signedBlock.encodedBlock
        ).stateSnapshotHash;

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
}
