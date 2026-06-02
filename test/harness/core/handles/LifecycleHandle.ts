import type { ChannelId, Hash } from "@/types/types";
import type { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export interface LifecycleHandle {
    connectToChannel(channelId: ChannelId): Promise<void>;
    joinChannel(req: {
        confirmation: JoinChannelConfirmationStruct;
        expectedSnapshotHash: Hash;
    }): Promise<void>;
}
