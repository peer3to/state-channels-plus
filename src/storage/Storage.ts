import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";

import { BlockCoordinates, StateSnapshot } from "@/models";
import { Block } from "@/models";

export class Storage {
    public readonly blocks = new BlockStorage();
    public readonly joinChannelBlocks = new JoinChannelBlockStorage();
    public readonly exitChannelBlocks = new ExitChannelBlockStorage();
    public readonly stateSnapshots = new StateSnapshotStorage();

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
