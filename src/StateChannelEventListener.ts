import { StateChannelManagerInterface } from "@typechain-types";
import { Filter, Log } from "ethers";

import EventSyncService from "@/stateManager/eventSync/EventSyncService";
import { ChannelId } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";

class StateChannelEventListener {
    private static readonly DISPOSE_TIMEOUT_MS = 30000;
    private readonly logger: Logger;
    private currentChannelKey?: string;
    private filter?: Filter;
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

    async setChannelId(channelId: ChannelId): Promise<void> {
        if (this.disposed) return;
        const channelKey = String(channelId).toLowerCase();
        if (channelKey === this.currentChannelKey && this.listener) return;
        await this.removeListener();
        this.eventSyncService.setChannelId(channelId);
        this.currentChannelKey = channelKey;
        const generation = ++this.generation;
        const filter = this.eventSyncService.getSubscriptionFilter(channelId);
        const listener = (log: Log) => {
            if (this.disposed || generation !== this.generation) return;
            this.logger.info("On-chain event received", {
                blockNumber: log.blockNumber,
                logIndex: log.index,
                transactionHash: log.transactionHash
            });
            DetachedPromises.collect(
                this.eventSyncService.scheduleLog(log, channelId)
            );
        };
        this.filter = filter;
        this.listener = listener;
        await this.getProvider().on(filter, listener);
    }

    async clearChannelId(): Promise<void> {
        if (this.disposed) return;
        this.generation += 1;
        await this.removeListener();
        this.currentChannelKey = undefined;
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.generation += 1;
        await this.removeListener();
        this.currentChannelKey = undefined;
        await this.eventSyncService.waitForScheduled(
            StateChannelEventListener.DISPOSE_TIMEOUT_MS
        );
    }

    private async removeListener(): Promise<void> {
        if (this.filter && this.listener) {
            await this.getProvider().off(this.filter, this.listener);
        }
        this.filter = undefined;
        this.listener = undefined;
    }

    private getProvider() {
        const provider = this.stateChannelManagerContract.runner?.provider;
        if (!provider) throw new Error("Event listener requires a provider");
        return provider;
    }
}

export default StateChannelEventListener;
