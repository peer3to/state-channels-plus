import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import EventSyncService from "@/stateManager/eventSync/EventSyncService";
import { ChannelId } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import { ChannelKey, channelKey as toChannelKey } from "@/utils/channelKey";
import { StateChannelManagerInterface } from "@typechain-types";
import { Filter, Log, WebSocketProvider } from "ethers";

class StateChannelEventListener {
    private static readonly DISPOSE_TIMEOUT_MS = 30000;
    private readonly logger: Logger;
    /** Every node socket the current listener was subscribed on. */
    private readonly subscribedSockets = new Set<WebSocketProvider>();
    private currentChannelKey?: ChannelKey;
    private filter?: Filter;
    private listener?: (log: Log) => void;
    /** Stops each node from handing its later sockets to the listener. */
    private unwatchNodes: (() => void)[] = [];
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
     * Subscribe the channel's logs on every RPC node. Every node's stream
     * feeds scheduleStreamedLog, which deduplicates them. A node socket that opens
     * later is subscribed too, and its missed logs are caught up.
     */
    async setChannelId(channelId: ChannelId): Promise<void> {
        if (this.disposed) return;
        const channelKey = toChannelKey(channelId);
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
                this.eventSyncService.scheduleStreamedLog(log, channelId)
            );
        };
        this.filter = filter;
        this.listener = listener;
        const provider = this.getProvider();
        // where a catch-up starts while no event has completed a block yet
        const subscribedAtBlock = await provider.getBlockNumber();
        if (this.disposed || generation !== this.generation) return;
        const subscriptions: Promise<unknown>[] = [];
        this.unwatchNodes = provider.nodes.map((node) =>
            node.watchSockets((socket, reopened) => {
                if (this.disposed || generation !== this.generation) return;
                for (const subscribed of this.subscribedSockets) {
                    if (subscribed.destroyed)
                        this.subscribedSockets.delete(subscribed);
                }
                this.subscribedSockets.add(socket);
                const subscription = socket.on(filter, listener);
                if (!reopened) {
                    subscriptions.push(subscription);
                    return;
                }
                // subscribe first, then read up to the head: a log after the
                // read arrives on the new subscription
                DetachedPromises.collect(
                    subscription.then(() =>
                        this.eventSyncService.catchUpLogs(
                            node,
                            channelId,
                            subscribedAtBlock
                        )
                    )
                );
            })
        );
        await Promise.all(subscriptions);
    }

    async clearChannelId(): Promise<void> {
        if (this.disposed) return;
        this.generation += 1;
        await this.removeListener();
        this.currentChannelKey = undefined;
    }

    /** Stop accepting logs and drain work without starting an unsubscribe. */
    async stop(): Promise<void> {
        this.disposed = true;
        this.generation += 1;
        await this.eventSyncService.waitForScheduled(
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
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        const filter = this.filter;
        const listener = this.listener;
        const sockets = [...this.subscribedSockets];
        this.subscribedSockets.clear();
        this.filter = undefined;
        this.listener = undefined;
        if (!filter || !listener) return;
        // a destroyed socket has already dropped its subscriptions
        await Promise.all(
            sockets
                .filter((socket) => !socket.destroyed)
                .map((socket) => socket.off(filter, listener))
        );
    }

    private getProvider(): MultiRpcProvider {
        const provider = this.stateChannelManagerContract.runner?.provider;
        if (!(provider instanceof MultiRpcProvider))
            throw new Error(
                "Event listener requires the runtime's RPC node provider"
            );
        return provider;
    }
}

export default StateChannelEventListener;
