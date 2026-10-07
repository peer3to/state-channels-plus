import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider, {
    getReconnectDelayMs,
    NodeSocketSubscriptions
} from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import EventSyncService from "@/stateManager/eventSync/EventSyncService";
import { ChannelId } from "@/types/types";
import { DetachedPromises, Logger, sleep } from "@/utils";
import { ChannelKey, channelKey as toChannelKey } from "@/utils/channelKey";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import { Log, Provider } from "ethers";

class StateChannelEventListener {
    private static readonly DISPOSE_TIMEOUT_MS = 30000;
    private readonly logger: Logger;
    /** Every node socket the channel is subscribed on, with its callback. */
    private readonly subscribedSockets = new NodeSocketSubscriptions();
    private currentChannelKey?: ChannelKey;
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
        // where a catch-up starts while no event has completed a block yet
        const subscribedAtBlock = await provider.getBlockNumber();
        if (this.disposed || generation !== this.generation) return;
        const subscriptions: Promise<unknown>[] = [];
        this.unwatchNodes = provider.nodes.map((node) =>
            node.watchSockets((socket, reopened) => {
                if (this.disposed || generation !== this.generation) return;
                if (!reopened) {
                    subscriptions.push(
                        this.subscribedSockets.add(socket, filter, listener)
                    );
                    return;
                }
                // Hold this socket's live logs until its catch-up scheduled
                // the logs it read. Otherwise a newer live log can complete
                // first, move the watermark past a missed block, and the
                // catch-up drops that block's logs as below the watermark.
                const held: Log[] = [];
                let catchingUp = true;
                // Hold the watermark at the catch-up's first block until the
                // read reaches the head or is abandoned. Taken here, before
                // the requests this reconnect released can answer, so a log
                // a recovery query completes in a later block cannot move
                // the watermark past blocks the catch-up has not read.
                const releaseWatermark = this.eventSyncService.holdWatermark(
                    channelId,
                    subscribedAtBlock
                );
                const socketListener = (log: Log) => {
                    if (catchingUp) held.push(log);
                    else listener(log);
                };
                let socketLost = false;
                // Ends the catch-up once it read up to the head or is
                // abandoned: hands on the held live logs, then releases the
                // watermark. A second call finds nothing left to do.
                const endCatchUp = () => {
                    unwatchLoss();
                    catchingUp = false;
                    for (const log of held.splice(0)) listener(log);
                    releaseWatermark();
                };
                // The socket ending abandons its catch-up at once: a read
                // waiting for this node to reconnect must not hold the
                // watermark. The node's next socket catches up on its own.
                const unwatchLoss = node.watchConnectionLoss(() => {
                    socketLost = true;
                    endCatchUp();
                });
                // subscribe first, then read up to the head: a log after the
                // read arrives on the new subscription
                DetachedPromises.collect(
                    this.subscribedSockets
                        .add(socket, filter, socketListener)
                        .then(() =>
                            this.catchUpUntilRead(
                                node,
                                () => socketLost || socket.destroyed,
                                channelId,
                                subscribedAtBlock,
                                generation
                            )
                        )
                        .finally(endCatchUp)
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

    /**
     * Run the catch-up on a reopened socket until it read up to the head,
     * retrying a failed window with the reconnect backoff while the socket
     * stays open and the subscription is current. The first read goes
     * through the reopened node; after a failed read the remaining windows
     * are read through the runtime's provider, i.e. the first connected
     * node, so one endpoint that keeps failing cannot hold the watermark.
     */
    private async catchUpUntilRead(
        node: RpcNodeProvider,
        hasSocketEnded: () => boolean,
        channelId: ChannelId,
        subscribedAtBlock: number,
        generation: number
    ): Promise<void> {
        // a retry reads again only from the window that failed
        let resumeFrom: number | undefined;
        let reader: Provider = node;
        for (let failedAttempts = 0; ; failedAttempts++) {
            if (this.disposed || generation !== this.generation) return;
            if (hasSocketEnded()) return;
            resumeFrom = await this.eventSyncService.catchUpLogs(
                reader,
                channelId,
                subscribedAtBlock,
                resumeFrom
            );
            if (resumeFrom === undefined) return;
            reader = this.getProvider();
            await sleep(getReconnectDelayMs(failedAttempts));
        }
    }

    private async removeListener(): Promise<void> {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        this.listener = undefined;
        await this.subscribedSockets.clear();
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
