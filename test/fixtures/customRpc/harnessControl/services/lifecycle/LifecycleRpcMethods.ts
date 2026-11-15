// @spec-test-coverage-ignore: host-side lifecycle staging used by mapped tests
import type { LifecycleService } from "./LifecycleService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { ChannelId } from "@/types/types";

/** Private lifecycle staging endpoints for the test harness. */
export class LifecycleRpcMethods extends ANetworkRpcMethods<LifecycleService> {
    constructor(transport: NetworkTransport, service: LifecycleService) {
        super(transport, service);
    }

    public async stageChannelId(channelId: ChannelId): Promise<boolean> {
        await this.service.p2pManager.stateManager.setChannelId(channelId);
        return true;
    }

    public async getEncodedOpening(
        channelId: ChannelId,
        fromBlock: number
    ): Promise<{ encodedOpenChannel: string } | null> {
        const encodedOpenChannel = await this.service.getEncodedOpening(
            channelId,
            fromBlock
        );
        return encodedOpenChannel ? { encodedOpenChannel } : null;
    }

    public applyChannelOpenedEvent(openingBlock: number): Promise<boolean> {
        return this.service.applyChannelOpenedEvent(openingBlock);
    }
}

export default LifecycleRpcMethods;
