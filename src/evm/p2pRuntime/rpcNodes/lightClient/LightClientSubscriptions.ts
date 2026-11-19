import { LIGHT_CLIENT_METHODS } from "./lightClientWire";
import type RpcNodeProvider from "../RpcNodeProvider";
import type { NodeSocket } from "../RpcNodeProvider";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";

/** A lowercase 0x-prefixed contract address. */
type ContractAddress = string;
/** A log topic, lowercase 0x-prefixed 32 bytes. */
type LogTopic = string;
/** The id a node gave a light client subscription; it holds on that node's socket only. */
type SubscriptionId = string;

/** The subscription one socket holds for one contract. */
type HeldSubscription = { id: SubscriptionId; topics: readonly LogTopic[] };

/** One open node socket and what it is subscribed to. */
type SubscribedSocket = {
    node: RpcNodeProvider;
    held: Map<ContractAddress, HeldSubscription>;
    /** The contract each subscription of this socket pushes blocks for. */
    contracts: Map<SubscriptionId, ContractAddress>;
    /** This socket's subscription changes, one after another. */
    changes: Promise<void>;
    unwatchNotifications: () => void;
};

/**
 * Keeps one light client subscription per followed contract on every node
 * socket and hands on each block a node pushes for it. A socket that opens
 * later is subscribed too; the blocks pushed while a node was down are not
 * read again. Several nodes push the same block: the receiver tells them
 * apart by the block's hash.
 */
export class LightClientSubscriptions {
    private readonly logger: Logger;
    private readonly onBlock: (
        address: ContractAddress,
        block: unknown
    ) => void;
    /** What is followed: each contract and the log topics that concern its follower. */
    private readonly followed = new Map<ContractAddress, Set<LogTopic>>();
    private readonly sockets = new Map<NodeSocket, SubscribedSocket>();
    private readonly unwatchNodes: (() => void)[] = [];

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        onBlock: (address: ContractAddress, block: unknown) => void
    ) {
        this.logger = logger;
        this.onBlock = onBlock;
        for (const node of nodes)
            this.unwatchNodes.push(
                node.watchSockets((socket) => this.watch(node, socket))
            );
    }

    /** Follows `address` for the logs that carry `topic`, next to the topics already followed. */
    follow(address: ContractAddress, topic: LogTopic): void {
        const topics = this.followed.get(address) ?? new Set();
        topics.add(topic);
        this.followed.set(address, topics);
        this.subscribeSockets();
    }

    /** Stops following `topic` of `address`. True when no topic of the contract is followed any more. */
    unfollow(address: ContractAddress, topic: LogTopic): boolean {
        const topics = this.followed.get(address);
        if (!topics?.delete(topic)) return false;
        if (topics.size === 0) this.followed.delete(address);
        this.subscribeSockets();
        return topics.size === 0;
    }

    /** Hands on no block any more. The subscriptions end with the sockets. */
    close(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        for (const { unwatchNotifications } of this.sockets.values())
            unwatchNotifications();
        this.sockets.clear();
        this.followed.clear();
    }

    private watch(node: RpcNodeProvider, socket: NodeSocket): void {
        for (const [known, { unwatchNotifications }] of this.sockets)
            if (known.destroyed) {
                unwatchNotifications();
                this.sockets.delete(known);
            }
        const contracts = new Map<SubscriptionId, ContractAddress>();
        this.sockets.set(socket, {
            node,
            held: new Map(),
            contracts,
            changes: Promise.resolve(),
            unwatchNotifications: socket.watchNotifications(
                LIGHT_CLIENT_METHODS.notification,
                (params) => {
                    const { subscription, result } = (params ?? {}) as {
                        subscription?: SubscriptionId;
                        result?: unknown;
                    };
                    const address =
                        subscription === undefined
                            ? undefined
                            : contracts.get(subscription);
                    if (address !== undefined) this.onBlock(address, result);
                }
            )
        });
        this.subscribeSockets();
    }

    /** Brings every socket's subscriptions to what is followed now. */
    private subscribeSockets(): void {
        for (const [socket, subscribed] of this.sockets)
            subscribed.changes = subscribed.changes
                .then(() => this.subscribe(socket, subscribed))
                .catch((error: unknown) => {
                    // a socket that ended took its subscriptions with it
                    if (socket.destroyed) return;
                    this.logger.error("Light client subscription failed", {
                        ...LoggerUtils.getRpcNodeMetadata(subscribed.node.url),
                        error
                    });
                });
    }

    private async subscribe(
        socket: NodeSocket,
        subscribed: SubscribedSocket
    ): Promise<void> {
        for (const [address, followedTopics] of [...this.followed]) {
            const topics = [...followedTopics].sort();
            const held = subscribed.held.get(address);
            if (held && held.topics.join() === topics.join()) continue;
            // the old subscription ends first: both would push one block,
            // with the writes only where the block's logs match the topics
            if (held) {
                subscribed.held.delete(address);
                await this.unsubscribe(socket, subscribed, held.id);
            }
            const id = (await socket.send(LIGHT_CLIENT_METHODS.subscribe, [
                { address, topics }
            ])) as SubscriptionId;
            subscribed.held.set(address, { id, topics });
            subscribed.contracts.set(id, address);
        }
        for (const [address, held] of [...subscribed.held]) {
            if (this.followed.has(address)) continue;
            subscribed.held.delete(address);
            await this.unsubscribe(socket, subscribed, held.id);
        }
    }

    private async unsubscribe(
        socket: NodeSocket,
        subscribed: SubscribedSocket,
        id: SubscriptionId
    ): Promise<void> {
        subscribed.contracts.delete(id);
        await socket.send(LIGHT_CLIENT_METHODS.unsubscribe, [id]);
    }
}
