import { NodeSocketSubscriptions } from "./RpcNodeProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    type AbstractProvider,
    type EventFilter,
    JsonRpcApiProvider,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    type Listener,
    Log,
    makeError,
    type ProviderEvent,
    type Subscriber,
    type Subscription
} from "ethers";

/** A block height. */
type BlockNumber = number;
/** A log's identity on every node of one chain: block hash and index. */
type LogId = string;

/** Block heights below the highest delivered log whose log ids are kept. */
const REMEMBERED_LOG_BLOCKS = 128;

/**
 * Relays one subscription from every node's socket to the provider. Sockets
 * come and go with reconnects; events missed while a node is down are not
 * read again.
 */
abstract class RpcNodesSocketSubscriber implements Subscriber {
    protected readonly provider: AbstractProvider;
    protected paused = false;
    private readonly nodes: readonly RpcNodeProvider[];
    private readonly event: ProviderEvent;
    private readonly unwatchNodes: (() => void)[] = [];
    /** Node sockets this subscriber listens on. */
    private readonly sockets = new NodeSocketSubscriptions();

    constructor(
        provider: AbstractProvider,
        nodes: readonly RpcNodeProvider[],
        event: ProviderEvent
    ) {
        this.provider = provider;
        this.nodes = nodes;
        this.event = event;
    }

    /** Called with each event of any node socket. */
    protected abstract readonly onEvent: Listener;

    start(): void {
        for (const node of this.nodes) {
            this.unwatchNodes.push(
                node.watchSockets((socket) => {
                    void this.sockets.add(socket, this.event, this.onEvent);
                })
            );
        }
    }

    stop(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        void this.sockets.clear();
    }

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        this.paused = false;
    }
}

/**
 * Relays `block` events from every node's socket, each new height once, so
 * a transaction wait reacts to new blocks without polling.
 */
class RpcNodesBlockSubscriber extends RpcNodesSocketSubscriber {
    private latestBlockNumber = -1;
    protected readonly onEvent = (blockNumber: BlockNumber) => {
        if (this.paused || blockNumber <= this.latestBlockNumber) return;
        this.latestBlockNumber = blockNumber;
        void this.provider.emit("block", blockNumber);
    };

    constructor(provider: AbstractProvider, nodes: readonly RpcNodeProvider[]) {
        super(provider, nodes, "block");
    }
}

/**
 * Relays the logs of one filter from every node's socket, each log once. A
 * log older than {@link REMEMBERED_LOG_BLOCKS} below the highest delivered
 * one counts as delivered: nodes of one chain never lag that far apart.
 */
class RpcNodesLogSubscriber extends RpcNodesSocketSubscriber {
    private readonly filter: EventFilter;
    /** The ids of the delivered logs, per block height. */
    private readonly deliveredLogs = new Map<BlockNumber, Set<LogId>>();
    private highestBlockNumber = -1;
    protected readonly onEvent = (log: Log) => {
        if (this.paused) return;
        if (log.blockNumber <= this.highestBlockNumber - REMEMBERED_LOG_BLOCKS)
            return;
        const logId = `${log.blockHash}:${log.index}`;
        const delivered = this.deliveredLogs.get(log.blockNumber) ?? new Set();
        if (delivered.has(logId)) return;
        delivered.add(logId);
        this.deliveredLogs.set(log.blockNumber, delivered);
        this.forgetLogsBelow(log.blockNumber);
        void this.provider.emit(this.filter, new Log(log, this.provider));
    };

    constructor(
        provider: AbstractProvider,
        nodes: readonly RpcNodeProvider[],
        filter: EventFilter
    ) {
        super(provider, nodes, filter);
        this.filter = filter;
    }

    private forgetLogsBelow(blockNumber: BlockNumber): void {
        if (blockNumber <= this.highestBlockNumber) return;
        this.highestBlockNumber = blockNumber;
        for (const remembered of this.deliveredLogs.keys())
            if (remembered <= blockNumber - REMEMBERED_LOG_BLOCKS)
                this.deliveredLogs.delete(remembered);
    }
}

/**
 * The runtime's chain provider over several RPC nodes in list order. Every
 * request, read or transaction, goes to the first node with an open socket
 * and moves to the next one only when that node has no open socket or loses
 * it before answering. While no node is connected a request waits for the
 * first one to reconnect; the wait is warned about once per outage and ends
 * with a rejection on destroy or stopReconnecting. Block events and contract
 * log subscriptions come from every node's socket, each block and each log
 * once, so `on(filter)` keeps delivering while any node is connected; logs
 * emitted while a node is down are not read again from it.
 */
export default class MultiRpcProvider extends JsonRpcApiProvider {
    readonly nodes: readonly RpcNodeProvider[];
    private readonly logger: Logger;
    /** Requests waiting for any node to connect. */
    private readonly connectionWaiters = new Set<() => void>();
    /** False once the owning runtime is gone; waiting requests are rejected. */
    private reconnects = true;
    /** Whether this outage of every node was already warned about. */
    private allNodesDownWarned = false;
    /** Requests sent so far; a slow setup's step timings count them. */
    private sentRequestCount = 0;

    get requestCount(): number {
        return this.sentRequestCount;
    }

    constructor(nodes: readonly RpcNodeProvider[], logger: Logger) {
        // cacheTimeout -1: ethers keeps a failed answer for 250 ms and would
        // hand it to a retry of the same request without asking a node
        super(undefined, {
            staticNetwork: true,
            batchMaxCount: 1,
            cacheTimeout: -1
        });
        this.nodes = nodes;
        this.logger = logger.child({ component: "RpcNodes" });
        for (const node of nodes) {
            node.watchConnectionLoss(() => this.onNodeLost());
            node.watchSockets(() => {
                this.allNodesDownWarned = false;
            });
        }
        // network detection and the request queue start now
        this._start();
    }

    /**
     * See {@link RpcNodeProvider.stopReconnecting}; applies to every node and
     * rejects the requests waiting for a node to connect. Requests in flight
     * on an open socket still get their answers.
     */
    stopReconnecting(): void {
        this.reconnects = false;
        for (const node of this.nodes) node.stopReconnecting();
        this.releaseConnectionWaiters();
    }

    // Implements JsonRpcApiProvider._send: each request goes to the first
    // connected node and fails over to the next one when that node drops.
    async _send(
        payload: JsonRpcPayload | Array<JsonRpcPayload>
    ): Promise<Array<JsonRpcResult | JsonRpcError>> {
        // batchMaxCount is 1, so the request queue never batches
        const requests = Array.isArray(payload) ? payload : [payload];
        this.sentRequestCount += requests.length;
        return Promise.all(requests.map((request) => this.forward(request)));
    }

    // Overrides JsonRpcApiProvider._getSubscriber: block events and contract
    // logs come from the nodes' sockets. The defaults poll one node through
    // this provider, and a log filter id is known to that node only.
    override _getSubscriber(sub: Subscription): Subscriber {
        if (sub.type === "block")
            return new RpcNodesBlockSubscriber(this, this.nodes);
        if (sub.type === "event")
            return new RpcNodesLogSubscriber(this, this.nodes, sub.filter);
        return super._getSubscriber(sub);
    }

    // Overrides JsonRpcApiProvider.destroy: also destroys every node and
    // rejects the requests waiting for or in flight on a node.
    override destroy(): void {
        for (const node of this.nodes) node.destroy();
        super.destroy();
        this.releaseConnectionWaiters();
    }

    private async forward(request: JsonRpcPayload): Promise<JsonRpcResult> {
        const params = Array.isArray(request.params)
            ? request.params
            : [request.params];
        for (;;) {
            this.assertServing(request.method);
            for (const node of this.nodes) {
                const sent = await node.trySendOnCurrentSocket(
                    request.method,
                    params
                );
                if (sent) return { id: request.id, result: sent.result };
            }
            // destroyed while the request was on a node
            this.assertServing(request.method);
            if (!this.reconnects)
                throw makeError(
                    "no RPC node is connected and none reconnects",
                    "NETWORK_ERROR",
                    { event: request.method }
                );
            await this.waitForConnectedNode();
        }
    }

    private assertServing(method: string): void {
        if (this.destroyed)
            throw makeError(
                "RPC node provider destroyed; cancelled request",
                "UNSUPPORTED_OPERATION",
                { operation: method }
            );
    }

    private onNodeLost(): void {
        if (this.allNodesDownWarned || !this.reconnects) return;
        if (this.nodes.some((node) => node.isConnected)) return;
        this.allNodesDownWarned = true;
        this.logger.warn(
            "Every RPC node is disconnected; chain requests wait for a reconnect",
            LoggerUtils.getRpcNodesMetadata(this.nodes.map((node) => node.url))
        );
    }

    private waitForConnectedNode(): Promise<void> {
        return new Promise<void>((resolve) => {
            const unwatchNodes: (() => void)[] = [];
            let resumed = false;
            const resume = () => {
                if (resumed) return;
                resumed = true;
                this.connectionWaiters.delete(resume);
                for (const unwatch of unwatchNodes.splice(0)) unwatch();
                resolve();
            };
            if (this.destroyed || !this.reconnects) {
                resume();
                return;
            }
            this.connectionWaiters.add(resume);
            // a node connected now calls resume at once
            for (const node of this.nodes)
                unwatchNodes.push(node.watchSockets(resume));
            if (resumed)
                for (const unwatch of unwatchNodes.splice(0)) unwatch();
        });
    }

    private releaseConnectionWaiters(): void {
        for (const resume of [...this.connectionWaiters]) resume();
    }
}
