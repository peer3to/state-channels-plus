import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import { ChannelId } from "@/types/types";
import { channelKey, ChannelKey } from "@/utils/channelKey";
type BlockNumber = number;

export class EventSyncStorage {
    private readonly latestProcessedBlocks: PersistentCollection<
        ChannelKey,
        BlockNumber
    >;

    constructor(controller?: PersistenceController) {
        this.latestProcessedBlocks = new PersistentCollection(
            "eventSync",
            controller
        );
    }

    getLatestProcessedBlock(channelId: ChannelId): BlockNumber | undefined {
        return this.latestProcessedBlocks.get(channelKey(channelId));
    }

    storeLatestProcessedBlock(
        channelId: ChannelId,
        blockNumber: BlockNumber
    ): BlockNumber {
        const latest = this.latestProcessedBlocks.update(
            channelKey(channelId),
            (existing) => Math.max(existing ?? 0, blockNumber)
        );
        return latest!;
    }
}
