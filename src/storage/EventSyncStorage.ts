import type { ChannelId } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type ChannelKey = string;
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

    public getLatestProcessedBlock(
        channelId: ChannelId
    ): BlockNumber | undefined {
        return this.latestProcessedBlocks.get(this.getChannelKey(channelId));
    }

    public storeLatestProcessedBlock(
        channelId: ChannelId,
        blockNumber: BlockNumber
    ): BlockNumber {
        const latest = this.latestProcessedBlocks.update(
            this.getChannelKey(channelId),
            (existing) => Math.max(existing ?? 0, blockNumber)
        );
        return latest!;
    }

    private getChannelKey(channelId: ChannelId): ChannelKey {
        return String(channelId).toLowerCase();
    }
}
