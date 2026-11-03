import {
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    isObject,
    LIMIT_EXCEEDED_ERROR_CODE,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    rpcError,
    filterRecord,
    type AccountAddress,
    type StagedBlock,
    type SubscriptionId
} from "./blockStorageDiff";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

/** `scp_disconnect` reason for a peer cut for falling behind. */
export const SEND_BUFFER_OVERFLOW = "send-buffer-overflow";
/** WebSocket close code for that cut: policy violation. */
export const SEND_BUFFER_OVERFLOW_CLOSE_CODE = 1008;

const MAX_PEER_PAYLOAD_BYTES = 1024 * 1024;
/** How long a cut peer gets to drain the notice before the socket drops. */
const PEER_CLOSE_GRACE_MS = 10_000;
/** HTTP status of a refused upgrade from an origin not allowed. */
const ORIGIN_REFUSED_STATUS = 403;
/** HTTP status of a refused upgrade while every connection is taken. */
const CONNECTIONS_FULL_STATUS = 503;

/** Endpoint names a request may route to: the endpoint class's own methods. */
const ENDPOINTS: ReadonlySet<string> = new Set(
    Object.getOwnPropertyNames(StorageDiffRpcMethods.prototype).filter(
        (name) => name !== "constructor"
    )
);

/** One connected peer and the subscriptions it opened. */
export interface StorageDiffPeer {
    socket: WebSocket;
    subscriptions: Map<SubscriptionId, AccountAddress[]>;
    nextSubscription: number;
    /** Accounts this peer's subscriptions and requests hold, and how many holds of each. */
    held: Map<AccountAddress, number>;
    /** Requests of this peer being answered now. */
    inFlight: number;
    /** Cut for falling behind; gets nothing more. */
    closing: boolean;
}

/** What the peer hub uses of the service whose peers it serves. */
export interface PeerHubOptions {
    host: string;
    /** 0 binds an OS-assigned port. */
    port: number;
    /** A peer whose unsent bytes pass this is told why and cut. */
    maxPeerBufferedBytes: number;
    /** Connections open at once; one more is refused at the upgrade. */
    maxConnections: number;
    /** Requests of one peer answered at once; one more is answered with an error. */
    maxInFlightRequests: number;
    /** Browser origins that may connect; a connection without an `Origin` header always may. */
    allowedOrigins: string[];
    /** The endpoints one connection's requests reach. */
    createMethods: (peer: StorageDiffPeer) => StorageDiffRpcMethods;
    /** Called once a peer's connection closed. */
    disconnected: (peer: StorageDiffPeer) => void;
    /** Called when the server fails. */
    fail: (error: unknown) => void;
}

/** The WebSocket server of the service and the peers connected to it. */
export class PeerHub {
    readonly peers = new Map<WebSocket, StorageDiffPeer>();
    private readonly host: string;
    private readonly port: number;
    private readonly maxPeerBufferedBytes: number;
    private readonly maxConnections: number;
    private readonly maxInFlightRequests: number;
    // `Origin` header values that may connect.
    private readonly allowedOrigins: ReadonlySet<string>;
    private readonly createMethods: (
        peer: StorageDiffPeer
    ) => StorageDiffRpcMethods;
    private readonly disconnected: (peer: StorageDiffPeer) => void;
    private readonly fail: (error: unknown) => void;
    private server?: WebSocketServer;

    constructor(options: PeerHubOptions) {
        this.host = options.host;
        this.port = options.port;
        this.maxPeerBufferedBytes = options.maxPeerBufferedBytes;
        this.maxConnections = options.maxConnections;
        this.maxInFlightRequests = options.maxInFlightRequests;
        this.allowedOrigins = new Set(options.allowedOrigins);
        this.createMethods = options.createMethods;
        this.disconnected = options.disconnected;
        this.fail = options.fail;
    }

    get url(): string {
        if (!this.server)
            throw new Error("StorageDiffService is not listening");
        const address = this.server.address() as AddressInfo;
        const bound =
            address.family === "IPv6"
                ? `[${address.address}]`
                : address.address;
        return `ws://${bound}:${address.port}`;
    }

    /** Drops every peer and stops listening. */
    async close(): Promise<void> {
        for (const socket of this.peers.keys()) socket.terminate();
        await new Promise<void>((resolve) => {
            if (!this.server) return resolve();
            this.server.close(() => resolve());
        });
    }

    async listen(): Promise<void> {
        const server = new WebSocketServer({
            host: this.host,
            port: this.port,
            maxPayload: MAX_PEER_PAYLOAD_BYTES,
            // Decided while the upgrade is handled, before its connection
            // counts: a refused one gets an HTTP error and no socket.
            verifyClient: ({ origin }, admit) => {
                if (origin && !this.allowedOrigins.has(origin))
                    return admit(
                        false,
                        ORIGIN_REFUSED_STATUS,
                        "Origin not allowed"
                    );
                if (this.peers.size >= this.maxConnections)
                    return admit(
                        false,
                        CONNECTIONS_FULL_STATUS,
                        "Too many connections"
                    );
                admit(true);
            }
        });
        this.server = server;
        await new Promise<void>((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        server.on("error", (error) => this.fail(error));
        server.on("connection", (socket) => this.accept(socket));
    }

    send(socket: WebSocket, message: unknown): void {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(message));
    }

    publish(record: StagedBlock): void {
        for (const [socket, peer] of this.peers) {
            if (peer.closing) continue;
            for (const [subscription, addresses] of peer.subscriptions) {
                this.send(socket, {
                    jsonrpc: "2.0",
                    method: "scp_subscription",
                    params: {
                        subscription,
                        result: filterRecord(record, addresses)
                    }
                });
            }
            this.dropIfLagging(peer);
        }
    }

    private accept(socket: WebSocket): void {
        const peer: StorageDiffPeer = {
            socket,
            subscriptions: new Map(),
            nextSubscription: 0,
            held: new Map(),
            inFlight: 0,
            closing: false
        };
        const methods = this.createMethods(peer);
        this.peers.set(socket, peer);
        socket.on("error", () => socket.terminate());
        socket.on("close", () => {
            this.peers.delete(socket);
            this.disconnected(peer);
        });
        socket.on("message", (data, isBinary) => {
            this.handleRpc(
                peer,
                methods,
                isBinary ? "" : data.toString()
            ).catch(() => socket.terminate());
        });
    }

    private async handleRpc(
        peer: StorageDiffPeer,
        methods: StorageDiffRpcMethods,
        raw: string
    ): Promise<void> {
        const { socket } = peer;
        // an answer the peer does not read counts toward its buffer limit too
        const answer = (message: unknown) => {
            if (peer.closing) return;
            this.send(socket, message);
            this.dropIfLagging(peer);
        };
        const reply = (id: unknown, code: number, message: string) =>
            answer({ jsonrpc: "2.0", id, error: { code, message } });
        let request: unknown;
        try {
            request = JSON.parse(raw);
        } catch {
            return reply(null, PARSE_ERROR, "Parse error");
        }
        if (Array.isArray(request)) {
            return reply(
                null,
                INVALID_REQUEST,
                "Batch requests are not supported"
            );
        }
        const id = isObject(request) ? request.id : undefined;
        if (
            !isObject(request) ||
            request.jsonrpc !== "2.0" ||
            typeof request.method !== "string" ||
            (id !== undefined &&
                id !== null &&
                typeof id !== "string" &&
                typeof id !== "number")
        ) {
            return reply(null, INVALID_REQUEST, "Invalid Request");
        }
        const notification = !("id" in request);
        // JSON-RPC 2.0 lets a request leave out empty params
        const params = request.params ?? [];
        try {
            if (!ENDPOINTS.has(request.method)) {
                throw rpcError(METHOD_NOT_FOUND, "Method not found");
            }
            if (!Array.isArray(params)) {
                throw rpcError(INVALID_PARAMS, "params must be an array");
            }
            if (peer.inFlight >= this.maxInFlightRequests)
                throw rpcError(
                    LIMIT_EXCEEDED_ERROR_CODE,
                    `At most ${this.maxInFlightRequests} requests of a connection are answered at once`
                );
            const endpoint = request.method as keyof StorageDiffRpcMethods;
            peer.inFlight++;
            let result: unknown;
            try {
                result = await methods[endpoint](params);
            } finally {
                peer.inFlight--;
            }
            if (!notification) answer({ jsonrpc: "2.0", id, result });
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (notification) return;
            if (typeof code === "number") {
                reply(id, code, (error as Error).message);
            } else {
                reply(id, INTERNAL_ERROR, "Internal error");
            }
        }
    }

    // The limit applies to the socket's aggregate buffered bytes, so a
    // catch-up reply the peer has not drained counts as well.
    // A peer that cannot keep up recovers with catch-up, not lost records.
    private dropIfLagging(peer: StorageDiffPeer): void {
        if (peer.socket.bufferedAmount > this.maxPeerBufferedBytes) {
            this.dropLagging(peer);
        }
    }

    /** Tells a peer it fell behind, then closes once the notice drains. */
    private dropLagging(peer: StorageDiffPeer): void {
        const { socket } = peer;
        peer.closing = true;
        this.send(socket, {
            jsonrpc: "2.0",
            method: "scp_disconnect",
            params: {
                reason: SEND_BUFFER_OVERFLOW,
                bufferedBytes: socket.bufferedAmount,
                limitBytes: this.maxPeerBufferedBytes
            }
        });
        socket.close(SEND_BUFFER_OVERFLOW_CLOSE_CODE, SEND_BUFFER_OVERFLOW);
        const grace = setTimeout(() => socket.terminate(), PEER_CLOSE_GRACE_MS);
        socket.once("close", () => clearTimeout(grace));
    }
}
