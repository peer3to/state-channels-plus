import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";

import { BlockCoordinates, StateSnapshot } from "@/models";
import { Block } from "@/models";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

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
    getStateSnapshot(coordinates: BlockCoordinates): StateSnapshot {
        const { forkId, height } = coordinates;

        if (height < 0) {
            return this.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            ) as StateSnapshot;
        }

        const blockConfirmation = this.blocks.getBlockConfirmation(
            forkId,
            height
        ) as BlockConfirmationStruct;

        const stateSnapshotHash = Block.decode(
            blockConfirmation.signedBlock.encodedBlock
        ).stateSnapshotHash;

        return this.stateSnapshots.getStateSnapshotByHash(
            stateSnapshotHash
        ) as StateSnapshot;
    }
}
