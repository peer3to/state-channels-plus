import type { LifecycleHandle } from "../handles/LifecycleHandle";
import type { ChannelId, Hash } from "@/types/types";
import type { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { TestPeer } from "../types";

export class InlineLifecycleHandle implements LifecycleHandle {
    constructor(private readonly peer: TestPeer) {}

    async connectToChannel(channelId: ChannelId): Promise<void> {
        await this.peer.p2pInstance.p2pSigner.connectToChannel(
            channelId as string
        );
    }

    async joinChannel(req: {
        confirmation: JoinChannelConfirmationStruct;
        expectedSnapshotHash: Hash;
    }): Promise<void> {
        await this.peer.p2pInstance.p2pSigner.joinChannel(
            req.confirmation,
            req.expectedSnapshotHash as string
        );
    }
}
