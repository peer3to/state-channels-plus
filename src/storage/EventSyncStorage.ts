import { ChannelId } from "@/types/types";
import { channelKey, ChannelKey } from "@/utils/channelKey";
type BlockNumber = number;

export class EventSyncStorage {
    private readonly latestProcessedBlocks = new Map<ChannelKey, BlockNumber>();

    getLatestProcessedBlock(channelId: ChannelId): BlockNumber | undefined {
        return this.latestProcessedBlocks.get(channelKey(channelId));
    }

    storeLatestProcessedBlock(
        channelId: ChannelId,
        blockNumber: BlockNumber
    ): BlockNumber {
        const key = channelKey(channelId);
        const latest = Math.max(
            this.latestProcessedBlocks.get(key) ?? 0,
            blockNumber
        );
        this.latestProcessedBlocks.set(key, latest);
        return latest;
    }
}
