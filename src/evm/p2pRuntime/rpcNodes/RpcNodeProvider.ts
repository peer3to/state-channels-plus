import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    JsonRpcApiProvider,
    type JsonRpcError,
    type Listener,
    type ProviderEvent,
    type JsonRpcPayload,
    type JsonRpcResult,
    makeError,
    Network,
    WebSocketProvider
} from "ethers";

/** First reconnect delay after a dropped or refused socket. */
const RECONNECT_INITIAL_DELAY_MS = 250;
/** Upper bound of the doubling reconnect delay. */
const RECONNECT_MAX_DELAY_MS = 5_000;
/** How long one connection attempt may take before it counts as failed. */
const CONNECT_TIMEOUT_MS = 10_000;
/** How often an open socket proves it still answers. */
const HEARTBEAT_INTERVAL_MS = 10_000;
/** How long a heartbeat may take before the socket counts as dead. */
const HEARTBEAT_TIMEOUT_MS = 5_000;
/** What a heartbeat asks; any answer, an error one too, proves the socket alive. */
const HEARTBEAT_METHOD = "eth_blockNumber";
/** Least time between two warnings about one node's failed reconnects. */
const RECONNECT_WARNING_INTERVAL_MS = 60_000;

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

/** Called with the block a node's notification names: a new head (`isHead`) or a log's block. */
export type AnnouncedBlockWatcher = (
    blockNumber: bigint,
    isHead: boolean
) => void;

/** One open socket and the end of its life. */
type NodeConnection = {
    socket: WebSocketProvider;
    ended: Promise<typeof SOCKET_ENDED>;
    hasEnded: boolean;
    /** Ends the connection, e.g. after a failed heartbeat. */
    end: (reason: Error) => void;
    heartbeat: ReturnType<typeof setInterval>;
};

/**
 * The chain every node of one runtime must serve. The first node to connect
 * pins it; a node that serves another chain is refused and keeps retrying.
 */
export type ExpectedChain = { chainId?: bigint };

export type RpcNodeProviderOptions = {
    /**
     * False for a node that serves no Ethereum RPC (an Asset Hub Substrate
     * node): it has no chain id to detect or check, so a connection counts as
     * open once the node answers a request at all, an error answer included.
     */
    ethereum?: boolean;
};

/** The network of a node that serves no Ethereum RPC: never asked for. */
const NOT_ETHEREUM_NETWORK = new Network("not-ethereum", 0n);

/**
 * Whether the node refused a subscription kind but names `newBlockHeaders` as
 * an offered one. Asset Hub's eth-rpc answers "Invalid params" and names the
 * offered kinds in the error's `data`.
 */
function offersNewBlockHeaders(error: unknown): boolean {
    const reasons =
        typeof error === "object" && error !== null && "error" in error
            ? [
                  (error.error as { message?: unknown })?.message,
                  (error.error as { data?: unknown })?.data
              ]
            : [error instanceof Error ? error.message : undefined];
    return reasons.some(
        (reason) =>
            typeof reason === "string" && reason.includes("newBlockHeaders")
    );
}

/** A node's WebSocket. */
class NodeSocket extends WebSocketProvider {
    /**
     * Called with the block number of each subscription notification the node
     * pushes (a new head or a log), before the subscriber hears of it.
     */
    announced?: AnnouncedBlockWatcher;

    // Overrides SocketProvider._processMessage: also reports the block each
    // subscription notification belongs to.
    override async _processMessage(message: string): Promise<void> {
        // only subscription notifications are parsed here; RPC replies are not
        if (this.announced && message.includes("eth_subscription"))
            this.reportAnnouncedBlock(message, this.announced);
        await super._processMessage(message);
    }

    // Overrides JsonRpcApiProvider.send: ethers sends a removed subscription's
    // eth_unsubscribe unawaited, so any failure (e.g. the socket destroyed
    // before the answer) is settled here; the subscription ends with the socket.
    // ethers also keeps an eth_subscribe answer unhandled: one cancelled by
    // this socket's destroy never settles, as the subscription is gone with it.
    // A node that refuses newHeads but offers newBlockHeaders (Asset Hub) is
    // asked for that instead: its pushes carry the same header `number`.
    override send(
        method: string,
        params: unknown[] | Record<string, unknown>
    ): Promise<unknown> {
        const answer = super.send(method, params);
        if (method === "eth_unsubscribe") answer.catch(() => undefined);
        if (method === "eth_subscribe")
            return answer.catch((error: unknown) => {
                if (this.destroyed) return new Promise<never>(() => undefined);
                if (
                    Array.isArray(params) &&
                    params[0] === "newHeads" &&
                    offersNewBlockHeaders(error)
                )
                    return this.send("eth_subscribe", ["newBlockHeaders"]);
                throw error;
            });
        return answer;
    }

    private reportAnnouncedBlock(
        message: string,
        announced: AnnouncedBlockWatcher
    ): void {
        try {
            const parsed: unknown = JSON.parse(message);
            if (typeof parsed !== "object" || parsed === null) return;
            const { method, params } = parsed as {
                method?: unknown;
                params?: {
                    result?: {
                        blockNumber?: unknown;
                        number?: unknown;
                        removed?: unknown;
                    };
                };
            };
            if (method !== "eth_subscription") return;
            const result = params?.result;
            // a removed log belongs to an orphaned block: it announces nothing
            if (result?.removed === true) return;
            if (typeof result?.blockNumber === "string")
                announced(BigInt(result.blockNumber), false);
            else if (typeof result?.number === "string")
                announced(BigInt(result.number), true);
        } catch {
            // not a notification this hook understands: the socket handles it
        }
    }
}

/**
 * A socket to `url`. A URL the WebSocket constructor rejects becomes an error
 * that names the endpoint by scheme and host only: its text would carry the
 * whole URL, credentials included.
 */
function openSocket(url: string, ethereum: boolean): NodeSocket {
    try {
        return ethereum
            ? new NodeSocket(url)
            : new NodeSocket(url, NOT_ETHEREUM_NETWORK, {
                  staticNetwork: NOT_ETHEREUM_NETWORK
              });
    } catch {
        throw new Error(
            `Cannot open a WebSocket to ${LoggerUtils.getRpcNodeMetadata(url).rpcNode}`
        );
    }
}

/** Rejects with `message` after `ms`; `cancel` stops the timer. */
function deadline(ms: number, message: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return { expired, cancel: () => clearTimeout(timer) };
}

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

/** The params of a JSON-RPC `request` as a list. */
export function paramsOf(request: JsonRpcPayload): unknown[] {
    return Array.isArray(request.params) ? request.params : [request.params];
}

/**
 * Resolves with the reason once the socket errors or closes. ethers never
 * reconnects its socket.
 */
export function watchSocketEnd(socket: WebSocketProvider): Promise<Error> {
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
 * The node sockets one subscriber listens on, each with its event and
 * callback. Sockets come and go with reconnects; this is the one owner of
 * subscribing on a socket, forgetting destroyed ones and unsubscribing the
 * live ones.
 */
export class NodeSocketSubscriptions {
    /** Each subscribed socket and the event and callback it carries. */
    private readonly subscriptions = new Map<
        WebSocketProvider,
        { event: ProviderEvent; callback: Listener }
    >();

    /** Subscribe `callback` to `event` on `socket`. */
    add(
        socket: WebSocketProvider,
        event: ProviderEvent,
        callback: Listener
    ): Promise<WebSocketProvider> {
        for (const subscribed of this.subscriptions.keys()) {
            if (subscribed.destroyed) this.subscriptions.delete(subscribed);
        }
        this.subscriptions.set(socket, { event, callback });
        return socket.on(event, callback);
    }

    /** Unsubscribe every socket still open and forget them all. */
    async clear(): Promise<void> {
        const subscriptions = [...this.subscriptions];
        this.subscriptions.clear();
        // a destroyed socket has already dropped its subscriptions
        await Promise.all(
            subscriptions
                .filter(([socket]) => !socket.destroyed)
                .map(([socket, { event, callback }]) =>
                    socket.off(event, callback)
                )
        );
    }
}

/**
 * One RPC node behind a stable provider. Requests go to the node's current
 * WebSocket. A dropped socket, or one that stops answering its heartbeat, is
 * reconnected with a bounded doubling backoff; requests wait for the
 * reconnect and are then sent again, so a node that dropped never answers
 * with a connection error. A node that never connected fails its requests at
 * once. Each open socket is handed to the registered
 * {@link RpcNodeSocketWatcher}s for subscriptions.
 */
export default class RpcNodeProvider extends JsonRpcApiProvider {
    readonly url: string;
    /** Settles once the first connection attempt succeeded or failed. */
    readonly firstAttempt: Promise<Error | undefined>;
    private readonly logger: Logger;
    private readonly watchers = new Set<RpcNodeSocketWatcher>();
    /** Called with the block of each notification a socket of this node pushes. */
    private readonly announcedWatchers = new Set<AnnouncedBlockWatcher>();
    /** Called when an open socket of this node ends. */
    private readonly lossWatchers = new Set<() => void>();
    /** Requests waiting for this node to reconnect. */
    private readonly connectionWaiters = new Set<() => void>();
    private readonly expectedChain: ExpectedChain;
    private readonly ethereum: boolean;
    private connection?: NodeConnection;
    private failedAttempts = 0;
    private lastReconnectWarningAt?: number;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private hasConnected = false;
    private stopped = false;
    /** False once the owning runtime is gone: no reconnect and no log. */
    private reconnects = true;

    constructor(
        url: string,
        logger: Logger,
        expectedChain: ExpectedChain = {},
        options: RpcNodeProviderOptions = {}
    ) {
        // cacheTimeout -1: ethers keeps a failed answer for 250 ms and would
        // hand it to a retry of the same request without asking the node
        // a node that serves no Ethereum RPC is never asked for its chain id
        super(undefined, {
            staticNetwork:
                options.ethereum === false ? NOT_ETHEREUM_NETWORK : true,
            batchMaxCount: 1,
            cacheTimeout: -1
        });
        this.url = url;
        this.logger = logger.child({ component: "RpcNode" });
        this.expectedChain = expectedChain;
        this.ethereum = options.ethereum ?? true;
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
     * Calls `watcher` with the block number of every subscription
     * notification (a new head or a log) this node's sockets receive, before
     * their subscribers hear of it; a removed log is not reported. Returns
     * the function that stops the calls.
     */
    watchAnnouncedBlocks(watcher: AnnouncedBlockWatcher): () => void {
        this.announcedWatchers.add(watcher);
        return () => {
            this.announcedWatchers.delete(watcher);
        };
    }

    /** Calls `watcher` whenever an open socket of this node ends. */
    watchConnectionLoss(watcher: () => void): () => void {
        this.lossWatchers.add(watcher);
        return () => {
            this.lossWatchers.delete(watcher);
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
     * again, and rejects the requests waiting for a reconnect. A request in
     * flight on the open socket still gets its answer, and fails only if the
     * socket drops. For a runtime that is gone while the process-wide Clock
     * still reads through this provider.
     */
    stopReconnecting(): void {
        this.reconnects = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        if (this.connection) clearInterval(this.connection.heartbeat);
        // nothing will reconnect for requests still waiting
        this.releaseConnectionWaiters();
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
        this.reconnects = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        const connection = this.connection;
        this.connection = undefined;
        if (connection) {
            connection.hasEnded = true;
            clearInterval(connection.heartbeat);
            // a request in flight on the socket answers as dropped
            connection.end(new Error("RPC node provider destroyed"));
            void connection.socket.destroy();
        }
        this.releaseConnectionWaiters();
        this.watchers.clear();
        this.lossWatchers.clear();
        super.destroy();
    }

    private async forward(request: JsonRpcPayload): Promise<JsonRpcResult> {
        for (;;) {
            const connection = await this.awaitConnection(request.method);
            const params = paramsOf(request);
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
            if (!this.reconnects)
                throw makeError(
                    "RPC node stopped reconnecting; cancelled request",
                    "NETWORK_ERROR",
                    { event: method }
                );
            await new Promise<void>((resolve) =>
                this.connectionWaiters.add(resolve)
            );
        }
    }

    // never rejects: a failed attempt schedules the next one
    private async connect(): Promise<Error | undefined> {
        let socket: WebSocketProvider | undefined;
        const attemptDeadline = deadline(
            CONNECT_TIMEOUT_MS,
            "RPC node connection attempt timed out"
        );
        try {
            const opened = openSocket(this.url, this.ethereum);
            opened.announced = (blockNumber, isHead) => {
                for (const watcher of this.announcedWatchers)
                    watcher(blockNumber, isHead);
            };
            socket = opened;
            const socketEnd = watchSocketEnd(socket);
            const network = await Promise.race([
                this.ethereum ? socket.getNetwork() : this.firstAnswer(socket),
                socketEnd.then((reason) => Promise.reject(reason)),
                attemptDeadline.expired
            ]);
            const expected = this.expectedChain.chainId;
            if (
                network &&
                expected !== undefined &&
                network.chainId !== expected
            )
                throw new Error(
                    `RPC node serves chain ${network.chainId}, expected ${expected}`
                );
            if (this.stopped || !this.reconnects) {
                await socket.destroy();
                return undefined;
            }
            if (network) this.expectedChain.chainId = network.chainId;
            this.attach(socket, socketEnd);
            return undefined;
        } catch (error) {
            await socket?.destroy();
            const reason =
                error instanceof Error ? error : new Error(String(error));
            // the owner is gone, and so may be its logger
            if (this.stopped || !this.reconnects) return reason;
            this.logFailedAttempt(reason);
            this.scheduleReconnect();
            return reason;
        } finally {
            attemptDeadline.cancel();
        }
    }

    // the first failure of an outage warns, later ones at most once a minute
    private logFailedAttempt(reason: Error): void {
        const now = Date.now();
        const metadata = {
            ...LoggerUtils.getRpcNodeMetadata(this.url),
            failedAttempts: this.failedAttempts + 1,
            error: reason
        };
        if (
            this.failedAttempts === 0 ||
            this.lastReconnectWarningAt === undefined ||
            now - this.lastReconnectWarningAt >= RECONNECT_WARNING_INTERVAL_MS
        ) {
            this.lastReconnectWarningAt = now;
            this.logger.warn("RPC node connection attempt failed", metadata);
        } else {
            this.logger.debug("RPC node connection attempt failed", metadata);
        }
    }

    private attach(socket: WebSocketProvider, socketEnd: Promise<Error>) {
        let end!: (reason: Error) => void;
        const endReason = new Promise<Error>((resolve) => {
            end = resolve;
        });
        void socketEnd.then(end);
        const connection: NodeConnection = {
            socket,
            ended: endReason.then(() => SOCKET_ENDED),
            hasEnded: false,
            end,
            heartbeat: setInterval(
                () => void this.checkHeartbeat(connection),
                HEARTBEAT_INTERVAL_MS
            )
        };
        const reopened = this.hasConnected;
        this.connection = connection;
        this.failedAttempts = 0;
        this.lastReconnectWarningAt = undefined;
        if (!this.hasConnected) {
            this.hasConnected = true;
            // network detection and the request queue start now
            this._start();
        }
        this.logger.info(
            reopened ? "RPC node reconnected" : "RPC node connected",
            LoggerUtils.getRpcNodeMetadata(this.url)
        );
        void endReason.then((reason) => this.onSocketEnded(connection, reason));
        this.releaseConnectionWaiters();
        for (const watcher of this.watchers) watcher(socket, true);
    }

    /**
     * Settles once a socket to a node that serves no Ethereum RPC answered
     * the heartbeat request, an error answer included; a socket that ends
     * first rejects.
     */
    private async firstAnswer(socket: WebSocketProvider): Promise<undefined> {
        await socket.send(HEARTBEAT_METHOD, []).catch(() => undefined);
        if (socket.websocket.readyState !== 1)
            throw new Error("WebSocket closed");
        return undefined;
    }

    // a socket whose path died silently reports no close: it must answer
    private async checkHeartbeat(connection: NodeConnection): Promise<void> {
        if (connection.hasEnded) return;
        const heartbeatDeadline = deadline(
            HEARTBEAT_TIMEOUT_MS,
            "RPC node heartbeat timed out"
        );
        // an error answer is still an answer: the socket is alive
        const answered = connection.socket.send(HEARTBEAT_METHOD, []).then(
            () => undefined,
            (error: unknown) => {
                if (connection.hasEnded || this.stopped || !this.reconnects)
                    return;
                this.logger.debug("RPC node heartbeat answered with an error", {
                    ...LoggerUtils.getRpcNodeMetadata(this.url),
                    error
                });
            }
        );
        try {
            await Promise.race([
                answered,
                connection.ended,
                heartbeatDeadline.expired
            ]);
        } catch (error) {
            connection.end(
                error instanceof Error ? error : new Error(String(error))
            );
        } finally {
            heartbeatDeadline.cancel();
        }
    }

    private onSocketEnded(connection: NodeConnection, reason: Error): void {
        connection.hasEnded = true;
        clearInterval(connection.heartbeat);
        if (this.connection !== connection) return;
        this.connection = undefined;
        void connection.socket.destroy();
        if (!this.reconnects) return;
        this.logger.warn("RPC node connection lost", {
            ...LoggerUtils.getRpcNodeMetadata(this.url),
            error: reason
        });
        for (const watcher of this.lossWatchers) watcher();
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
