import { ethers } from "ethers";
import Storage from "@/storage";
import { BlockCoordinates, StateSnapshot } from "@/models";
import { ForkId } from "@/types/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

const NULL = "0x00";

export type PreviousEntity = {
    blockConfirmation?: BlockConfirmationStruct;
    stateSnapshot?: StateSnapshot;
};

export function isChannelOpen(forkId: ForkId): boolean {
    return forkId !== ethers.ZeroHash && forkId !== NULL;
}

export function getPreviousBlockOrSnapshot(
    coordinates: BlockCoordinates,
    storage: Storage
): PreviousEntity {
    const { forkId, height } = coordinates;

    if (height > 0) {
        const prevBlockEntry = storage.blocks.getBlockEntry(
            forkId,
            height - 1
        )!;

        return { blockConfirmation: prevBlockEntry.blockConfirmation };
    }

    const genesisSnapshot =
        storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId)!;
    return { stateSnapshot: genesisSnapshot };
}
