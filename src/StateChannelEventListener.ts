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
import { BigNumberish, getNumber, Log, Provider } from "ethers";

/** Marks a catch-up read whose socket ended before it answered. */
const CATCH_UP_ABANDONED = Symbol("catch-up abandoned");

class StateChannelEventListener {
    private static readonly DISPOSE_TIMEOUT_MS = 30000;
    private readonly logger: Logger;
    /** Every node socket the channel is subscribed on, with its callback. */
    private readonly subscribedSockets = new NodeSocketSubscriptions();
    private currentChannelKey?: ChannelKey;
    private listener?: (log: Log) => void;
    /** Stops each node from handing its later sockets to the listener. */
    private unwatchNodes: (() => void)[] = [];
    /**
     * Ends each running catch-up at once: a cleared or replaced
     * subscription must not keep the watermark held.
     */
    private readonly catchUpAborts = new Set<() => void>();
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
                let abandonCatchUp!: () => void;
                // settles once the socket ends: a read still waiting for
                // this node to reconnect is not awaited any longer
                const abandoned = new Promise<typeof CATCH_UP_ABANDONED>(
                    (resolve) => {
                        abandonCatchUp = () => resolve(CATCH_UP_ABANDONED);
                    }
                );
                // Ends the catch-up once it read up to the head or is
                // abandoned: hands on the held live logs, then releases the
                // watermark. A second call finds nothing left to do.
                const endCatchUp = () => {
                    this.catchUpAborts.delete(abortCatchUp);
                    unwatchLoss();
                    catchingUp = false;
                    for (const log of held.splice(0)) listener(log);
                    releaseWatermark();
                };
                // Clearing or replacing the subscription ends its catch-up at
                // once, without waiting for a read or a retry's backoff. The
                // held live logs belong to the removed subscription: dropped.
                const abortCatchUp = () => {
                    held.length = 0;
                    abandonCatchUp();
                    endCatchUp();
                };
                this.catchUpAborts.add(abortCatchUp);
                // The socket ending abandons its catch-up at once: a read
                // waiting for this node to reconnect must not hold the
                // watermark. The node's next socket catches up on its own.
                const unwatchLoss = node.watchConnectionLoss(() => {
                    socketLost = true;
                    abandonCatchUp();
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
                                abandoned,
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
     * Those reads still have to reach the reopened node's head, asked on
     * its socket before the switch: a head request answered with an error
     * is asked again on that socket after the backoff, and a first
     * connected node whose head is behind it is read again after the
     * backoff. A read in flight when the socket ends or the subscription is
     * removed is not awaited: it may wait for the node to reconnect, and
     * the node's next socket catches up itself.
     */
    private async catchUpUntilRead(
        node: RpcNodeProvider,
        hasSocketEnded: () => boolean,
        abandoned: Promise<typeof CATCH_UP_ABANDONED>,
        channelId: ChannelId,
        subscribedAtBlock: number,
        generation: number
    ): Promise<void> {
        // a retry reads again only from the window that failed
        let resumeFrom: number | undefined;
        let reader: Provider = node;
        // the reopened node's head, which a read through another node must
        // reach; unknown while the reopened node reads for itself
        let targetHead: number | undefined;
        // the reopened node failed a read and has not yet answered its head:
        // the head is asked again instead of reading logs
        let awaitingTargetHead = false;
        for (let failedAttempts = 0; ; failedAttempts++) {
            if (this.disposed || generation !== this.generation) return;
            if (hasSocketEnded()) return;
            if (!awaitingTargetHead) {
                const read = await Promise.race([
                    this.eventSyncService.catchUpLogs(
                        reader,
                        channelId,
                        subscribedAtBlock,
                        resumeFrom,
                        targetHead
                    ),
                    abandoned
                ]);
                if (read === CATCH_UP_ABANDONED) return;
                resumeFrom = read;
                if (resumeFrom === undefined) return;
                awaitingTargetHead = reader === node;
            }
            if (awaitingTargetHead) {
                const head = await Promise.race([
                    this.readSocketHead(node),
                    abandoned
                ]);
                if (head === CATCH_UP_ABANDONED) return;
                if (head !== undefined) {
                    targetHead = head;
                    reader = this.getProvider();
                    awaitingTargetHead = false;
                }
            }
            const slept = await Promise.race([
                sleep(getReconnectDelayMs(failedAttempts)),
                abandoned
            ]);
            if (slept === CATCH_UP_ABANDONED) return;
        }
    }

    /**
     * The reopened node's head, asked on its open socket without
     * waiting for a reconnect. Abandoned when the socket has ended;
     * `undefined` when the node answers with an error: the catch-up asks
     * again after the backoff.
     */
    private async readSocketHead(
        node: RpcNodeProvider
    ): Promise<number | undefined | typeof CATCH_UP_ABANDONED> {
        try {
            const answer = await node.trySendOnCurrentSocket(
                "eth_blockNumber",
                []
            );
            if (!answer) return CATCH_UP_ABANDONED;
            return getNumber(answer.result as BigNumberish);
        } catch (error) {
            this.logger.warn("Reconnected RPC node's head read failed", {
                ...LoggerUtils.getRpcNodeMetadata(node.url),
                error
            });
            return undefined;
        }
    }

    private async removeListener(): Promise<void> {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        for (const abortCatchUp of [...this.catchUpAborts]) abortCatchUp();
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
