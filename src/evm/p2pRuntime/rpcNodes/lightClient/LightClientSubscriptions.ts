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
/** Identifies one subscription across every socket: the key the listener knows it by. */
type SubscriptionKey = string;

/**
 * Most notifications kept for a subscription id the socket does not know
 * yet: a node can send the first push in the same frame batch as the id.
 */
const MAX_EARLY_NOTIFICATIONS = 64;

/** How long a socket waits before it tries a failed subscription change again: a peer3 block time. */
const RETRY_DELAY_MS = 2000;

/** What the subscriptions hand on. */
export type LightClientSubscriptionListener = {
    /** A node subscription for `contract` began. */
    subscribed(key: SubscriptionKey, contract: ContractAddress): void;
    /** It ended: on unsubscribe, when its socket closed, or before it is opened again. */
    unsubscribed(key: SubscriptionKey): void;
    /**
     * The node pushed `message` to it at `receivedAt`. False when the message
     * is refused: the subscription is opened again, so that the node syncs it.
     */
    pushed(key: SubscriptionKey, message: unknown, receivedAt: number): boolean;
    /** A subscription was opened again: the node ended it, or the listener refused a push. */
    resubscribed(): void;
};

/** The subscription one socket holds for one contract. */
type HeldSubscription = {
    id: SubscriptionId;
    key: SubscriptionKey;
    topics: readonly LogTopic[];
};

/** One open node socket and what it is subscribed to. */
type SubscribedSocket = {
    node: RpcNodeProvider;
    held: Map<ContractAddress, HeldSubscription>;
    /** Each subscription of this socket, by the id the node gave it. */
    byId: Map<SubscriptionId, HeldSubscription>;
    /** Notifications for an id this socket does not know yet, in order. */
    early: Map<SubscriptionId, { params: unknown; receivedAt: number }[]>;
    /** This socket's subscription changes, one after another. */
    changes: Promise<void>;
    /** The pending retry of a failed change, if one is pending. */
    retry?: ReturnType<typeof setTimeout>;
    unwatchNotifications: () => void;
};

/**
 * Keeps one light client subscription per followed contract on every node
 * socket and hands on each message a node pushes for it. A socket that opens
 * later is subscribed too, and syncs from the node's whole partition. A
 * subscription the node ends, or whose push the listener refuses, is opened
 * again.
 */
export class LightClientSubscriptions {
    private readonly logger: Logger;
    private readonly listener: LightClientSubscriptionListener;
    /** What is followed: each contract and the log topics that concern its follower. */
    private readonly followed = new Map<ContractAddress, Set<LogTopic>>();
    private readonly sockets = new Map<NodeSocket, SubscribedSocket>();
    private readonly unwatchNodes: (() => void)[] = [];
    private nextKey = 0;

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        listener: LightClientSubscriptionListener
    ) {
        this.logger = logger;
        this.listener = listener;
        for (const node of nodes)
            this.unwatchNodes.push(
                node.watchSockets((socket) => this.watch(node, socket)),
                // what a lost socket pushed is of a block the node may be past
                node.watchConnectionLoss(() => this.lost(node))
            );
    }

    /** Follows `address` for the logs that carry `topic`, next to the topics already followed. */
    follow(address: ContractAddress, topic: LogTopic): void {
        const topics = this.followed.get(address) ?? new Set();
        topics.add(topic);
        this.followed.set(address, topics);
        this.subscribeSockets();
    }

    /** Stops following `topic` of `address`. */
    unfollow(address: ContractAddress, topic: LogTopic): void {
        const topics = this.followed.get(address);
        if (!topics?.delete(topic)) return;
        if (topics.size === 0) this.followed.delete(address);
        this.subscribeSockets();
    }

    /** Hands on nothing any more. The subscriptions end with the sockets. */
    close(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        for (const subscribed of this.sockets.values()) this.forget(subscribed);
        this.sockets.clear();
        this.followed.clear();
    }

    private watch(node: RpcNodeProvider, socket: NodeSocket): void {
        this.lost(node);
        const subscribed: SubscribedSocket = {
            node,
            held: new Map(),
            byId: new Map(),
            early: new Map(),
            changes: Promise.resolve(),
            unwatchNotifications: socket.watchNotifications(
                LIGHT_CLIENT_METHODS.notification,
                (params) =>
                    this.notified(socket, subscribed, params, Date.now())
            )
        };
        this.sockets.set(socket, subscribed);
        this.subscribeSockets();
    }

    private notified(
        socket: NodeSocket,
        subscribed: SubscribedSocket,
        params: unknown,
        receivedAt: number
    ): void {
        const { subscription, result, error } = (params ?? {}) as {
            subscription?: SubscriptionId;
            result?: unknown;
            error?: unknown;
        };
        if (subscription === undefined) return;
        const held = subscribed.byId.get(subscription);
        if (!held) {
            const early = subscribed.early.get(subscription) ?? [];
            if (early.length < MAX_EARLY_NOTIFICATIONS)
                early.push({ params, receivedAt });
            subscribed.early.set(subscription, early);
            return;
        }
        // the node ends a subscription that fell behind with an error
        const accepted =
            error === undefined &&
            this.listener.pushed(held.key, result, receivedAt);
        if (!accepted) this.reopen(socket, subscribed, held);
    }

    /** Opens `held` again: the node syncs the new subscription from the whole partition. */
    private reopen(
        socket: NodeSocket,
        subscribed: SubscribedSocket,
        held: HeldSubscription
    ): void {
        for (const [contract, current] of subscribed.held)
            if (current === held) {
                subscribed.held.delete(contract);
                this.listener.resubscribed();
            }
        subscribed.changes = subscribed.changes.then(() =>
            this.unsubscribe(socket, subscribed, held)
        );
        this.subscribeSockets();
    }

    /** Brings every socket's subscriptions to what is followed now. */
    private subscribeSockets(): void {
        for (const [socket, subscribed] of this.sockets)
            this.subscribeSocket(socket, subscribed);
    }

    /** Brings `socket`'s subscriptions to what is followed now; a failure is tried again later. */
    private subscribeSocket(
        socket: NodeSocket,
        subscribed: SubscribedSocket
    ): void {
        subscribed.changes = subscribed.changes
            .then(() => this.subscribe(socket, subscribed))
            .catch((error: unknown) => {
                // a socket that ended took its subscriptions with it
                if (socket.destroyed || !this.sockets.has(socket)) return;
                this.logger.error("Light client subscription failed", {
                    ...LoggerUtils.getRpcNodeMetadata(subscribed.node.url),
                    error
                });
                subscribed.retry ??= setTimeout(() => {
                    subscribed.retry = undefined;
                    if (this.sockets.get(socket) === subscribed)
                        this.subscribeSocket(socket, subscribed);
                }, RETRY_DELAY_MS);
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
            // the old subscription ends first, so that no partition is pushed twice
            if (held) {
                subscribed.held.delete(address);
                await this.unsubscribe(socket, subscribed, held);
            }
            const key = String(this.nextKey++);
            this.listener.subscribed(key, address);
            let id: SubscriptionId;
            try {
                id = (await socket.send(LIGHT_CLIENT_METHODS.subscribe, [
                    { address, topics }
                ])) as SubscriptionId;
            } catch (error) {
                this.listener.unsubscribed(key);
                throw error;
            }
            const subscription = { id, key, topics };
            subscribed.held.set(address, subscription);
            subscribed.byId.set(id, subscription);
            const early = subscribed.early.get(id) ?? [];
            subscribed.early.delete(id);
            for (const { params, receivedAt } of early)
                this.notified(socket, subscribed, params, receivedAt);
        }
        for (const [address, held] of [...subscribed.held]) {
            if (this.followed.has(address)) continue;
            subscribed.held.delete(address);
            await this.unsubscribe(socket, subscribed, held);
        }
    }

    private async unsubscribe(
        socket: NodeSocket,
        subscribed: SubscribedSocket,
        held: HeldSubscription
    ): Promise<void> {
        if (!subscribed.byId.delete(held.id)) return;
        this.listener.unsubscribed(held.key);
        await socket.send(LIGHT_CLIENT_METHODS.unsubscribe, [held.id]);
    }

    /** Stops handing on what the earlier sockets of `node` pushed. */
    private lost(node: RpcNodeProvider): void {
        for (const [socket, subscribed] of this.sockets)
            if (subscribed.node === node) {
                this.forget(subscribed);
                this.sockets.delete(socket);
            }
    }

    /** Stops handing on what `subscribed`'s socket pushes. */
    private forget(subscribed: SubscribedSocket): void {
        clearTimeout(subscribed.retry);
        subscribed.retry = undefined;
        subscribed.unwatchNotifications();
        for (const { key } of subscribed.byId.values())
            this.listener.unsubscribed(key);
        subscribed.byId.clear();
        subscribed.held.clear();
        subscribed.early.clear();
    }
}
