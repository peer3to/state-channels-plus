// @spec-test-coverage-ignore: host-side lifecycle staging used by mapped tests
import LifecycleRpcMethods from "./LifecycleRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { ChannelId } from "@/types/types";

/** Private host-side lifecycle controls for external channel setup. */
export class LifecycleService extends ANetworkRpcService<LifecycleRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessLifecycleService"
            })
        );
    }

    public createRPCMethods(transport: NetworkTransport): LifecycleRpcMethods {
        return new LifecycleRpcMethods(transport, this);
    }

    /** `fromBlock`: a block at or before the opening; the read starts there. */
    public async getEncodedOpening(
        channelId: ChannelId,
        fromBlock: number
    ): Promise<string | null> {
        const contract =
            this.p2pManager.stateManager.stateChannelManagerContract;
        const events = await contract.queryFilter(
            contract.filters.ChannelOpened(channelId),
            fromBlock
        );
        const event = events.at(-1);
        if (!event) return null;
        const transaction = await event.getTransaction();
        const parsed = contract.interface.parseTransaction({
            data: transaction.data,
            value: transaction.value
        });
        if (!parsed || parsed.name !== "open") return null;
        return String(parsed.args[0].encodedOpenChannel);
    }

    /**
     * Re-deliver the selected channel's ChannelOpened log through the real
     * event pipeline, exactly as the chain listener would. Used to stage
     * "genesis arrives from the chain" on a runtime that selected the channel
     * after it opened. Returns false when no such log exists. The read starts
     * at `openingBlock`, the channel's opening block.
     */
    public async applyChannelOpenedEvent(
        openingBlock: number
    ): Promise<boolean> {
        const stateManager = this.p2pManager.stateManager;
        const channelId = stateManager.channelId;
        const contract = stateManager.stateChannelManagerContract;
        const events = await contract.queryFilter(
            contract.filters.ChannelOpened(channelId),
            openingBlock
        );
        const log = events.at(-1);
        if (!log) return false;
        await stateManager.eventSyncService.scheduleLog(log, channelId);
        return true;
    }
}

export default LifecycleService;
