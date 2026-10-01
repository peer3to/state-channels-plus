import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    JsonRpcApiProvider,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    makeError,
    WebSocketProvider
} from "ethers";

/** First reconnect delay after a dropped or refused socket. */
const RECONNECT_INITIAL_DELAY_MS = 250;
/** Upper bound of the doubling reconnect delay. */
const RECONNECT_MAX_DELAY_MS = 5_000;

/** Marks a request whose socket ended before it answered. */
const SOCKET_ENDED = Symbol("socket ended");

/**
 * Called with each open socket of a node. `reopened` is false for the call
 * made at registration on an already open socket, and true for every socket
 * opened after registration: events may have been missed before it.
 */
export type RpcNodeSocketWatcher = (
    socket: WebSocketProvider,
    reopened: boolean
) => void;

/** One open socket and the end of its life. */
type NodeConnection = {
    socket: WebSocketProvider;
    ended: Promise<typeof SOCKET_ENDED>;
    hasEnded: boolean;
};

/**
 * The delay before reconnect attempt `failedAttempts + 1`: doubling from
 * {@link RECONNECT_INITIAL_DELAY_MS}, bounded by {@link RECONNECT_MAX_DELAY_MS}.
 */
export function getReconnectDelayMs(failedAttempts: number): number {
    return Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_INITIAL_DELAY_MS * 2 ** Math.max(0, failedAttempts)
    );
}

function getSocketConnectionError(event: unknown): Error {
    if (event instanceof Error) return event;
    if (
        typeof event === "object" &&
        event !== null &&
        "error" in event &&
        event.error instanceof Error
    ) {
        return event.error;
    }
    return new Error("WebSocket connection failed");
}

/**
 * Resolves with the reason once the socket errors or closes. ethers never
 * reconnects its socket.
 */
function watchSocketEnd(socket: WebSocketProvider): Promise<Error> {
    // ethers does not install an `onerror` handler on its underlying socket.
    // In Node, `ws` therefore promotes a failed initial connection to an
    // uncaught Error instead of rejecting the provider readiness request.
    const websocket = socket.websocket;
    return new Promise((resolve) => {
        websocket.onerror = (event: unknown) =>
            resolve(getSocketConnectionError(event));
        // `ws` and the browser WebSocket both have `onclose`; ethers' socket
        // type does not declare it.
        if ("onclose" in websocket)
            websocket.onclose = () => resolve(new Error("WebSocket closed"));
    });
}

/**
 * One RPC node behind a stable provider. Requests go to the node's current
 * WebSocket. A dropped socket is reconnected with a bounded doubling backoff;
 * requests wait for the reconnect and are then sent again, so a node that
 * dropped never answers with a connection error. A node that never connected
 * fails its requests at once. Each open socket is handed to the registered
 * {@link RpcNodeSocketWatcher}s for subscriptions.
 */
export default class RpcNodeProvider extends JsonRpcApiProvider {
    readonly url: string;
    /** Settles once the first connection attempt succeeded or failed. */
    readonly firstAttempt: Promise<Error | undefined>;
    private readonly logger: Logger;
    private readonly watchers = new Set<RpcNodeSocketWatcher>();
    /** Requests waiting for this node to reconnect. */
    private readonly connectionWaiters = new Set<() => void>();
    private connection?: NodeConnection;
    private chainId?: bigint;
    private failedAttempts = 0;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private hasConnected = false;
    private stopped = false;
    /** False once the owning runtime is gone: no reconnect and no log. */
    private reconnects = true;

    constructor(url: string, logger: Logger) {
        super(undefined, { staticNetwork: true, batchMaxCount: 1 });
        this.url = url;
        this.logger = logger.child({ component: "RpcNode" });
        this.firstAttempt = this.connect();
    }

    get isConnected(): boolean {
        return this.connection !== undefined;
    }

    /**
     * Calls `watcher` with the open socket now and with every later socket.
     * Returns the function that stops the calls.
     */
    watchSockets(watcher: RpcNodeSocketWatcher): () => void {
        this.watchers.add(watcher);
        if (this.connection) watcher(this.connection.socket, false);
        return () => {
            this.watchers.delete(watcher);
        };
    }

    /**
     * Sends one request on the current socket without waiting for a
     * reconnect. `undefined` when the node has no open socket or the socket
     * ended before it answered; a node's rejection is thrown.
     */
    async trySendOnCurrentSocket(
        method: string,
        params: unknown[]
    ): Promise<{ result: unknown } | undefined> {
        const connection = this.connection;
        if (!connection) return undefined;
        const outcome = await this.sendOn(connection, method, params);
        return outcome === SOCKET_ENDED ? undefined : { result: outcome };
    }

    /**
     * Keeps the open socket serving requests but never reconnects or logs
     * again. For a runtime that is gone while the process-wide Clock still
     * reads through this provider.
     */
    stopReconnecting(): void {
        this.reconnects = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }

    // Implements JsonRpcApiProvider._send: forwards each request to the
    // node's current socket and sends it again after a reconnect.
    async _send(
        payload: JsonRpcPayload | Array<JsonRpcPayload>
    ): Promise<Array<JsonRpcResult | JsonRpcError>> {
        // batchMaxCount is 1, so the request queue never batches
        const requests = Array.isArray(payload) ? payload : [payload];
        return Promise.all(requests.map((request) => this.forward(request)));
    }

    // Overrides JsonRpcApiProvider.destroy: also stops reconnecting, closes
    // the current socket and fails the requests waiting for a reconnect.
    override destroy(): void {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        const connection = this.connection;
        this.connection = undefined;
        if (connection) {
            connection.hasEnded = true;
            void connection.socket.destroy();
        }
        this.releaseConnectionWaiters();
        this.watchers.clear();
        super.destroy();
    }

    private async forward(request: JsonRpcPayload): Promise<JsonRpcResult> {
        for (;;) {
            const connection = await this.awaitConnection(request.method);
            const params = Array.isArray(request.params)
                ? request.params
                : [request.params];
            const outcome = await this.sendOn(
                connection,
                request.method,
                params
            );
            // the socket dropped before answering: send it on the next one
            if (outcome !== SOCKET_ENDED)
                return { id: request.id, result: outcome };
        }
    }

    private async sendOn(
        connection: NodeConnection,
        method: string,
        params: unknown[]
    ): Promise<unknown> {
        try {
            return await Promise.race([
                connection.socket.send(method, params),
                connection.ended
            ]);
        } catch (error) {
            // a destroyed socket rejects what it still held
            if (connection.hasEnded) return SOCKET_ENDED;
            throw error;
        }
    }

    private async awaitConnection(method: string): Promise<NodeConnection> {
        await this.firstAttempt;
        for (;;) {
            if (this.stopped)
                throw makeError(
                    "RPC node provider destroyed; cancelled request",
                    "UNSUPPORTED_OPERATION",
                    { operation: method }
                );
            if (this.connection) return this.connection;
            if (!this.hasConnected)
                throw makeError("RPC node never connected", "NETWORK_ERROR", {
                    event: method
                });
            await new Promise<void>((resolve) =>
                this.connectionWaiters.add(resolve)
            );
        }
    }

    // never rejects: a failed attempt schedules the next one
    private async connect(): Promise<Error | undefined> {
        const socket = new WebSocketProvider(this.url);
        const socketEnd = watchSocketEnd(socket);
        try {
            const network = await Promise.race([
                socket.getNetwork(),
                socketEnd.then((reason) => Promise.reject(reason))
            ]);
            if (this.chainId !== undefined && network.chainId !== this.chainId)
                throw new Error(
                    `RPC node changed chain from ${this.chainId} to ${network.chainId}`
                );
            if (this.stopped || !this.reconnects) {
                await socket.destroy();
                return undefined;
            }
            this.chainId = network.chainId;
            this.attach(socket, socketEnd);
            return undefined;
        } catch (error) {
            await socket.destroy();
            const reason =
                error instanceof Error ? error : new Error(String(error));
            if (!this.reconnects) return reason;
            this.logger.warn("RPC node connection attempt failed", {
                ...LoggerUtils.getRpcNodeMetadata(this.url),
                failedAttempts: this.failedAttempts + 1,
                error: reason
            });
            this.scheduleReconnect();
            return reason;
        }
    }

    private attach(socket: WebSocketProvider, socketEnd: Promise<Error>) {
        const connection: NodeConnection = {
            socket,
            ended: socketEnd.then(() => SOCKET_ENDED),
            hasEnded: false
        };
        const reopened = this.hasConnected;
        this.connection = connection;
        this.failedAttempts = 0;
        if (!this.hasConnected) {
            this.hasConnected = true;
            // network detection and the request queue start now
            this._start();
        }
        this.logger.info(
            reopened ? "RPC node reconnected" : "RPC node connected",
            LoggerUtils.getRpcNodeMetadata(this.url)
        );
        void socketEnd.then((reason) => this.onSocketEnded(connection, reason));
        this.releaseConnectionWaiters();
        for (const watcher of this.watchers) watcher(socket, true);
    }

    private onSocketEnded(connection: NodeConnection, reason: Error): void {
        connection.hasEnded = true;
        if (this.connection !== connection) return;
        this.connection = undefined;
        void connection.socket.destroy();
        if (!this.reconnects) return;
        this.logger.warn("RPC node connection lost", {
            ...LoggerUtils.getRpcNodeMetadata(this.url),
            error: reason
        });
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.stopped || !this.reconnects || this.reconnectTimer) return;
        const delayMs = getReconnectDelayMs(this.failedAttempts);
        this.failedAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.connect();
        }, delayMs);
    }

    private releaseConnectionWaiters(): void {
        const waiters = [...this.connectionWaiters];
        this.connectionWaiters.clear();
        for (const resume of waiters) resume();
    }
}
