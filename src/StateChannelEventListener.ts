import MirrorRpcProvider from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import EventSyncService from "@/stateManager/eventSync/EventSyncService";
import { ChannelId } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import { ChannelKey, channelKey as toChannelKey } from "@/utils/channelKey";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import { Log } from "ethers";

class StateChannelEventListener {
    private static readonly DISPOSE_TIMEOUT_MS = 30000;
    private readonly logger: Logger;
    private currentChannelKey?: ChannelKey;
    /** Stops the log watch that feeds the listener. */
    private unwatchLogs?: () => void;
    private listener?: (log: Log) => void;
    private generation = 0;
    private disposed = false;

    constructor(
        private readonly stateChannelManagerContract: StateChannelManagerInterface,
        private readonly eventSyncService: EventSyncService,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "EventListener" });
    }

    /**
     * Watch the channel's logs on the provider's log feed: each log reaches
     * scheduleStreamedLog once its block is on the storage diff service's
     * best chain.
     */
    async setChannelId(channelId: ChannelId): Promise<void> {
        if (this.disposed) return;
        const channelKey = toChannelKey(channelId);
        if (channelKey === this.currentChannelKey && this.listener) return;
        // claimed before the await: a clear or newer set during it wins
        const generation = ++this.generation;
        await this.removeListener();
        if (this.disposed || generation !== this.generation) return;
        this.eventSyncService.setChannelId(channelId);
        this.currentChannelKey = channelKey;
        const filter = this.eventSyncService.getSubscriptionFilter(channelId);
        const listener = (log: Log) => {
            if (this.disposed || generation !== this.generation) return;
            this.logger.debug(
                "On-chain event streamed",
                LoggerUtils.getContractLogMetadata(log)
            );
            DetachedPromises.collect(
                this.eventSyncService.scheduleStreamedLog(log, channelId)
            );
        };
        this.listener = listener;
        const provider = this.getProvider();
        // the watch starts after the head, as a node subscription would:
        // logs up to it are history
        const head = await provider.getBlockNumber();
        if (this.disposed || generation !== this.generation) return;
        this.unwatchLogs = provider.logs.watch(filter, head + 1, listener);
    }

    async clearChannelId(): Promise<void> {
        if (this.disposed) return;
        // a select started during the removal owns the key
        const generation = ++this.generation;
        await this.removeListener();
        if (generation === this.generation) this.currentChannelKey = undefined;
    }

    /** Stop accepting logs and drain work without starting an unsubscribe. */
    async stop(): Promise<void> {
        this.disposed = true;
        this.generation += 1;
        await this.eventSyncService.stop(
            StateChannelEventListener.DISPOSE_TIMEOUT_MS
        );
    }

    async dispose(): Promise<void> {
        try {
            await this.stop();
        } finally {
            await this.removeListener();
            this.currentChannelKey = undefined;
        }
    }

    private async removeListener(): Promise<void> {
        this.unwatchLogs?.();
        this.unwatchLogs = undefined;
        this.listener = undefined;
    }

    private getProvider(): MirrorRpcProvider {
        const provider = this.stateChannelManagerContract.runner?.provider;
        if (!(provider instanceof MirrorRpcProvider))
            throw new Error(
                "Event listener requires the runtime's RPC node provider"
            );
        return provider;
    }
}

export default StateChannelEventListener;
