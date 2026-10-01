import { NodeSocketSubscriptions } from "./RpcNodeProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    type AbstractProvider,
    JsonRpcApiProvider,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    makeError,
    type Subscriber,
    type Subscription
} from "ethers";

/**
 * Relays `block` events from every node's socket, each new height once, so
 * a transaction wait reacts to new blocks without polling.
 */
class RpcNodesBlockSubscriber implements Subscriber {
    private readonly provider: AbstractProvider;
    private readonly nodes: readonly RpcNodeProvider[];
    private readonly unwatchNodes: (() => void)[] = [];
    /** Node sockets this subscriber listens on. */
    private readonly sockets = new NodeSocketSubscriptions();
    private latestBlockNumber = -1;
    private paused = false;
    private readonly onBlock = (blockNumber: number) => {
        if (this.paused || blockNumber <= this.latestBlockNumber) return;
        this.latestBlockNumber = blockNumber;
        void this.provider.emit("block", blockNumber);
    };

    constructor(provider: AbstractProvider, nodes: readonly RpcNodeProvider[]) {
        this.provider = provider;
        this.nodes = nodes;
    }

    start(): void {
        for (const node of this.nodes) {
            this.unwatchNodes.push(
                node.watchSockets((socket) => {
                    void this.sockets.add(socket, "block", this.onBlock);
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
 * The runtime's chain provider over several RPC nodes in list order. Every
 * request, read or transaction, goes to the first node with an open socket
 * and moves to the next one only when that node has no open socket or loses
 * it before answering. While no node is connected a request waits for the
 * first one to reconnect; the wait is warned about once per outage and ends
 * with a rejection on destroy or stopReconnecting. Block events come from the
 * nodes' sockets. Contract log subscriptions are made per node on
 * {@link nodes}, not on this provider.
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

    constructor(nodes: readonly RpcNodeProvider[], logger: Logger) {
        super(undefined, { staticNetwork: true, batchMaxCount: 1 });
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
     * rejects the requests waiting for a node to connect.
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
        return Promise.all(requests.map((request) => this.forward(request)));
    }

    // Overrides AbstractProvider._getSubscriber: block events come from the
    // nodes' sockets. The default polls the nodes through this provider.
    override _getSubscriber(sub: Subscription): Subscriber {
        if (sub.type === "block")
            return new RpcNodesBlockSubscriber(this, this.nodes);
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
