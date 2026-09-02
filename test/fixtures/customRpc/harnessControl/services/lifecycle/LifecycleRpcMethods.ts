// @spec-test-coverage-ignore: host-side lifecycle staging used by mapped tests
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ChannelId } from "@/types/types";
import type { LifecycleService } from "./LifecycleService";

/** Private lifecycle staging endpoints for the test harness. */
export class LifecycleRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: LifecycleService
    ) {
        super(transport, service.p2pManager);
    }

    public async stageChannelId(channelId: ChannelId): Promise<boolean> {
        await this.service.p2pManager.stateManager.setChannelId(channelId);
        return true;
    }

    public async getEncodedOpening(
        channelId: ChannelId
    ): Promise<{ encodedOpenChannel: string } | null> {
        const encodedOpenChannel =
            await this.service.getEncodedOpening(channelId);
        return encodedOpenChannel ? { encodedOpenChannel } : null;
    }
}

export default LifecycleRpcMethods;
