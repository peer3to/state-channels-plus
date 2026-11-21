import { LIGHT_CLIENT_METHODS } from "./lightClientWire";
import type RpcNodeProvider from "../RpcNodeProvider";
import { isMethodNotServed, type NodeSocket } from "../RpcNodeProvider";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";

/** A lowercase 0x-prefixed contract address. */
export type ContractAddress = string;
/** A log topic, lowercase 0x-prefixed 32 bytes. */
type LogTopic = string;
/** The id a node gave a light client subscription; it holds on that node's socket only. */
type SubscriptionId = string;
/** Identifies one subscription across every socket: the key the listener knows it by. */
export type SubscriptionKey = string;

/**
 * Most notifications kept for a subscription id the socket does not know
 * yet: a node can send the first push in the same frame batch as the id.
 */
const MAX_EARLY_NOTIFICATIONS = 64;

/** Most unknown subscription ids whose notifications are kept while a subscribe waits for its id. */
const MAX_EARLY_SUBSCRIPTIONS = 4;

/** How long a failed subscription change waits before it is tried again: a peer3 block time. */
export const SUBSCRIPTION_RETRY_DELAY_MS = 2000;

/** What the subscriptions hand on. */
export type LightClientSubscriptionListener = {
    /** A subscription for `contract` on a socket of `node` began. */
    subscribed(
        key: SubscriptionKey,
        contract: ContractAddress,
        node: RpcNodeProvider
    ): void;
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

/** A `lightClient_storage` notification: a pushed message, or the error that ended the subscription. */
type SubscriptionNotification = {
    subscription: SubscriptionId;
    result?: unknown;
    error?: unknown;
};

function isSubscriptionNotification(
    params: unknown
): params is SubscriptionNotification {
    return (
        typeof params === "object" &&
        params !== null &&
        typeof (params as Partial<SubscriptionNotification>).subscription ===
            "string"
    );
}

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
    /**
     * Notifications for an id this socket does not know yet, in order: kept
     * only while a subscribe waits for its id, and dropped once it has it.
     */
    early: Map<SubscriptionId, { params: unknown; receivedAt: number }[]>;
    /** Whether a subscribe on this socket waits for its id. */
    isSubscribing: boolean;
    /** False once the node answered that it does not serve the light client endpoints. */
    isServed: boolean;
    /** This socket's subscription changes, one after another. */
    changes: Promise<void>;
    /** The pending retry of a failed change, if one is pending. */
    retry?: ReturnType<typeof setTimeout>;
    unwatchNotifications: () => void;
};

/**
 * Keeps one light client subscription per followed contract on every node
 * socket, once started, and hands on each message a node pushes for it. A
 * socket that opens later is subscribed too, and syncs from the node's whole
 * partition. A subscription the node ends, or whose push the listener
 * refuses, is opened again.
 */
export class LightClientSubscriptions {
    private readonly logger: Logger;
    private readonly listener: LightClientSubscriptionListener;
    /** What is followed: each contract and the log topics that concern its follower. */
    private readonly followed = new Map<ContractAddress, Set<LogTopic>>();
    private readonly sockets = new Map<NodeSocket, SubscribedSocket>();
    private readonly unwatchNodes: (() => void)[] = [];
    private nextKey = 0;
    /** Whether the sockets subscribe: what is followed before it is only kept. */
    private hasStarted = false;

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

    /** Subscribes what is followed, from now on: the listener takes what the nodes push. */
    start(): void {
        if (this.hasStarted) return;
        this.hasStarted = true;
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
            isSubscribing: false,
            isServed: true,
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
        if (!isSubscriptionNotification(params)) return;
        const { subscription, result, error } = params;
        const held = subscribed.byId.get(subscription);
        if (!held) {
            // only the id a subscribe still waits for can be one of ours
            if (!subscribed.isSubscribing) return;
            let early = subscribed.early.get(subscription);
            if (!early) {
                if (subscribed.early.size >= MAX_EARLY_SUBSCRIPTIONS) return;
                early = [];
                subscribed.early.set(subscription, early);
            }
            if (early.length < MAX_EARLY_NOTIFICATIONS)
                early.push({ params, receivedAt });
            return;
        }
        // the node ends a subscription that fell behind with an error
        if (error !== undefined)
            this.logger.warn(
                "RPC node ended a light client subscription; subscribing again",
                {
                    ...LoggerUtils.getRpcNodeMetadata(subscribed.node.url),
                    error
                }
            );
        const accepted =
            error === undefined &&
            this.listener.pushed(held.key, result, receivedAt);
        if (!accepted) this.reopen(socket, subscribed, held);
    }

    /**
     * Opens `held` again after a block time: the node syncs the new
     * subscription from the whole partition. The wait keeps a node whose
     * pushes keep failing from being asked for a whole partition every round
     * trip.
     */
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
        this.subscribeLater(socket, subscribed);
    }

    /** Brings every socket's subscriptions to what is followed now, once started. */
    private subscribeSockets(): void {
        if (!this.hasStarted) return;
        for (const [socket, subscribed] of this.sockets)
            this.subscribeSocket(socket, subscribed);
    }

    /**
     * Brings `socket`'s subscriptions to what is followed now; a failure is
     * tried again later. A socket whose node does not serve the light client
     * endpoints is left alone.
     */
    private subscribeSocket(
        socket: NodeSocket,
        subscribed: SubscribedSocket
    ): void {
        if (!subscribed.isServed) return;
        subscribed.changes = subscribed.changes
            .then(() => this.subscribe(socket, subscribed))
            .catch((error: unknown) => {
                // a socket that ended took its subscriptions with it
                if (socket.destroyed || !this.sockets.has(socket)) return;
                const metadata = LoggerUtils.getRpcNodeMetadata(
                    subscribed.node.url
                );
                // the light client is optional: this node's socket stays without it
                if (isMethodNotServed(error)) {
                    subscribed.isServed = false;
                    this.logger.info(
                        "RPC node doesn't support LC endpoints; its socket is not subscribed",
                        metadata
                    );
                    return;
                }
                this.logger.error("Light client subscription failed", {
                    ...metadata,
                    error
                });
                this.subscribeLater(socket, subscribed);
            });
    }

    /** Brings `socket`'s subscriptions to what is followed after a block time. */
    private subscribeLater(
        socket: NodeSocket,
        subscribed: SubscribedSocket
    ): void {
        subscribed.retry ??= setTimeout(() => {
            subscribed.retry = undefined;
            if (this.sockets.get(socket) === subscribed)
                this.subscribeSocket(socket, subscribed);
        }, SUBSCRIPTION_RETRY_DELAY_MS);
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
            this.listener.subscribed(key, address, subscribed.node);
            let id: unknown;
            subscribed.isSubscribing = true;
            try {
                id = await socket.send(LIGHT_CLIENT_METHODS.subscribe, [
                    { address, topics }
                ]);
                if (typeof id !== "string")
                    throw new Error(
                        "The node answered a light client subscribe without a subscription id"
                    );
            } catch (error) {
                subscribed.isSubscribing = false;
                subscribed.early.clear();
                this.listener.unsubscribed(key);
                throw error;
            }
            subscribed.isSubscribing = false;
            const subscription = { id, key, topics };
            subscribed.held.set(address, subscription);
            subscribed.byId.set(id, subscription);
            const early = subscribed.early.get(id) ?? [];
            subscribed.early.clear();
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
