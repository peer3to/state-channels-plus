import { ethers } from "ethers";
import Storage from "@/storage";
import { BlockCoordinates } from "@/models";
import { ForkId, BlockOrSnapshot } from "@/types/types";

const NULL = "0x00";

export function isChannelOpen(forkId: ForkId): boolean {
    return forkId !== ethers.ZeroHash && forkId !== NULL;
}

export function getPreviousBlockOrSnapshot(
    coordinates: BlockCoordinates,
    storage: Storage
): BlockOrSnapshot {
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
