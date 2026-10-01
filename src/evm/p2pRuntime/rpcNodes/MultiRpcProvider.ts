import type RpcNodeProvider from "./RpcNodeProvider";
import {
    type AbstractProvider,
    JsonRpcApiProvider,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    makeError,
    type Subscriber,
    type Subscription,
    type WebSocketProvider
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
    private readonly sockets = new Set<WebSocketProvider>();
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
                    for (const listened of this.sockets) {
                        if (listened.destroyed) this.sockets.delete(listened);
                    }
                    this.sockets.add(socket);
                    void socket.on("block", this.onBlock);
                })
            );
        }
    }

    stop(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        for (const socket of this.sockets) {
            if (!socket.destroyed) void socket.off("block", this.onBlock);
        }
        this.sockets.clear();
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
 * first one to reconnect, as a single dropped node's requests do. Block
 * events come from the nodes' sockets. Contract log subscriptions are made
 * per node on {@link nodes}, not on this provider.
 */
export default class MultiRpcProvider extends JsonRpcApiProvider {
    readonly nodes: readonly RpcNodeProvider[];
    /** Requests waiting for any node to connect. */
    private readonly connectionWaiters = new Set<() => void>();

    constructor(nodes: readonly RpcNodeProvider[]) {
        super(undefined, { staticNetwork: true, batchMaxCount: 1 });
        this.nodes = nodes;
        // network detection and the request queue start now
        this._start();
    }

    /** See {@link RpcNodeProvider.stopReconnecting}; applies to every node. */
    stopReconnecting(): void {
        for (const node of this.nodes) node.stopReconnecting();
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
    // fails the requests waiting for a node to connect.
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
            if (this.destroyed)
                throw makeError(
                    "RPC node provider destroyed; cancelled request",
                    "UNSUPPORTED_OPERATION",
                    { operation: request.method }
                );
            for (const node of this.nodes) {
                const sent = await node.trySendOnCurrentSocket(
                    request.method,
                    params
                );
                if (sent) return { id: request.id, result: sent.result };
            }
            await this.waitForConnectedNode();
        }
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
