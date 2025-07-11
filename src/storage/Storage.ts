import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { ExitPointsStorage } from "./ExitPointsStorage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { deepCopyProxy } from "@/utils";

export class Storage {
    public readonly blocks: BlockStorage;
    public readonly joinChannelBlocks: JoinChannelBlockStorage;
    public readonly exitChannelBlocks: ExitChannelBlockStorage;
    public readonly stateSnapshots: StateSnapshotStorage;
    public readonly exitPoints: ExitPointsStorage;

    constructor() {
        this.blocks = deepCopyProxy(new BlockStorage());
        this.joinChannelBlocks = deepCopyProxy(new JoinChannelBlockStorage());
        this.exitChannelBlocks = deepCopyProxy(new ExitChannelBlockStorage());
        this.stateSnapshots = deepCopyProxy(new StateSnapshotStorage());
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

        const blockConfirmation = this.blocks.getBlockConfirmation(
            forkId,
            height
        );
        if (!blockConfirmation) {
            return undefined;
        }

        const stateSnapshotHash = Block.decode(
            blockConfirmation.signedBlock.encodedBlock
        ).stateSnapshotHash;

        return this.stateSnapshots.getStateSnapshotByHash(stateSnapshotHash);
    }
}
