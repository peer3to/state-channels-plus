import { ChannelId } from "@/types/types";

type ChannelKey = string;
type BlockNumber = number;

export class EventSyncStorage {
    private readonly latestProcessedBlocks = new Map<ChannelKey, BlockNumber>();

    getLatestProcessedBlock(channelId: ChannelId): BlockNumber | undefined {
        return this.latestProcessedBlocks.get(this.getChannelKey(channelId));
    }

    storeLatestProcessedBlock(
        channelId: ChannelId,
        blockNumber: BlockNumber
    ): BlockNumber {
        const key = this.getChannelKey(channelId);
        const latest = Math.max(
            this.latestProcessedBlocks.get(key) ?? 0,
            blockNumber
        );
        this.latestProcessedBlocks.set(key, latest);
        return latest;
    }

    private getChannelKey(channelId: ChannelId): ChannelKey {
        return String(channelId).toLowerCase();
    }
}
