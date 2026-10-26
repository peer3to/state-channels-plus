import {
    filterRecord,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    isObject,
    mergeTransactionDiffs,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    parseHeader,
    PRUNED_ERROR_CODE,
    rpcError,
    toQuantity,
    type AccountAddress,
    type AccountDiffs,
    type BlockHeader,
    type BlockStorageDiff,
    type SubscriptionId
} from "./blockStorageDiff";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import {
    UpstreamRequestError,
    UpstreamRpcClient,
    UpstreamTimeoutError
} from "./UpstreamRpcClient";
import type { Logger } from "@/utils";
import { retry } from "@/utils/retry";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

export const DEFAULT_RETENTION_BLOCKS = 128;
/** Retries of a failed head reconciliation before the service fails. */
export const RECONCILE_RETRY_LIMIT = 3;
/** Delay before the first retry; each further retry doubles it. */
export const RECONCILE_RETRY_BACKOFF_MS = 250;

const MAX_PEER_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
const DEFAULT_PORT = 19778;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

/** Endpoint names a request may route to: the endpoint class's own methods. */
const ENDPOINTS: ReadonlySet<string> = new Set(
    Object.getOwnPropertyNames(StorageDiffRpcMethods.prototype).filter(
        (name) => name !== "constructor"
    )
);

export interface StorageDiffServiceOptions {
    /** `ws://` or `wss://` upstream that serves `newHeads` and tracing. */
    upstreamUrl: string;
    host?: string;
    /** 0 binds an OS-assigned port; read it from `url`. */
    port?: number;
    /** Canonical blocks kept for catch-up; an integer of at least 1. */
    retention?: number;
    logger: Logger;
}

/** One connected peer and the subscriptions it opened. */
export interface StorageDiffPeer {
    socket: WebSocket;
    subscriptions: Map<SubscriptionId, AccountAddress[]>;
    nextSubscription: number;
}

/** The upstream chain moved while a reconciliation read it. */
class HeadChangedError extends Error {}

function isTransient(error: unknown): boolean {
    return (
        error instanceof HeadChangedError ||
        error instanceof UpstreamRequestError ||
        error instanceof UpstreamTimeoutError
    );
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as { code?: unknown }).code;
        return [typeof code === "string" ? code : "", error.message]
            .filter(Boolean)
            .join(" ");
    }
    return "unknown error";
}

const noAncestor = () => new Error("Upstream chain shares no ancestor");

/**
 * Standalone Ethereum storage write-set service. It follows the best head of
 * one trusted upstream (`eth_subscribe` `newHeads`), traces every new block once
 * with `prestateTracer` in diff mode, keeps the last `retention` canonical
 * records, and serves address-filtered JSON-RPC 2.0 over WebSocket:
 * `scp_subscribeContractStorage` pushes future records,
 * `scp_getContractStorageDiffs` replays retained ones and `scp_unsubscribe`
 * ends a subscription. A reorg or an upstream error answer or timeout during
 * reconciliation is retried; a lost upstream socket, or a failure that
 * outlasts the retries, is fatal: a supervisor restarts the process and
 * consumers catch up.
 *
 * Batch requests are refused as invalid requests. There is no authentication:
 * binding beyond loopback is the operator's responsibility.
 */
export class StorageDiffService {
    /** Resolves after `close`; rejects when the service fails fatally. */
    readonly closed: Promise<void>;
    private readonly logger: Logger;
    private readonly upstreamUrl: string;
    /** The upstream URL without path or credentials, for messages. */
    private readonly upstreamEndpoint: string;
    private readonly host: string;
    private readonly port: number;
    private readonly retention: number;
    private readonly peers = new Map<WebSocket, StorageDiffPeer>();
    private readonly stopping = new AbortController();
    private upstream?: UpstreamRpcClient;
    private server?: WebSocketServer;
    private canonical: BlockStorageDiff[] = [];
    // One serialized queue: reconciliation commits branches in order, and
    // subscriptions and catch-up reads see a consistent canonical history.
    private queueTail: Promise<unknown> = Promise.resolve();
    private ready = false;
    private wakePending = false;
    private wakeQueued = false;
    private shutdown?: Promise<void>;
    private settleClosed!: {
        resolve: () => void;
        reject: (error: Error) => void;
    };

    private constructor(
        options: StorageDiffServiceOptions,
        upstreamEndpoint: string
    ) {
        this.logger = options.logger;
        this.upstreamUrl = options.upstreamUrl;
        this.upstreamEndpoint = upstreamEndpoint;
        this.host = options.host ?? "127.0.0.1";
        this.port = options.port ?? DEFAULT_PORT;
        this.retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        this.closed = new Promise<void>((resolve, reject) => {
            this.settleClosed = { resolve, reject };
        });
        this.closed.catch(() => undefined);
    }

    /**
     * Starts the service: subscribes to the upstream's heads, loads the last
     * `retention` canonical blocks, then listens. Rejects (after cleaning up)
     * when the upstream or the port is unusable.
     */
    static async start(
        options: StorageDiffServiceOptions
    ): Promise<StorageDiffService> {
        let upstreamEndpoint: string;
        try {
            const parsed = new URL(options.upstreamUrl);
            if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
                throw new Error("unsupported protocol");
            }
            upstreamEndpoint = `${parsed.protocol}//${parsed.host}`;
        } catch {
            throw new Error(
                "upstreamUrl must be a ws:// or wss:// URL (newHeads needs a subscription transport)"
            );
        }
        const retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        if (!Number.isInteger(retention) || retention < 1) {
            throw new Error("retention must be an integer of at least 1");
        }
        const port = options.port ?? DEFAULT_PORT;
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("port must be an integer between 0 and 65535");
        }
        const service = new StorageDiffService(options, upstreamEndpoint);
        await service.open();
        return service;
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

    /** Idempotent: closes peers, the upstream socket and pending work. */
    close(): Promise<void> {
        return this.teardown();
    }

    async subscribe(
        peer: StorageDiffPeer,
        addresses: AccountAddress[]
    ): Promise<SubscriptionId> {
        return await this.enqueue(async () => {
            if (!this.peers.has(peer.socket)) throw new Error("Peer closed");
            const id = "0x" + (++peer.nextSubscription).toString(16);
            peer.subscriptions.set(id, addresses);
            return id;
        });
    }

    /** Takes effect at once: no record is pushed to `id` after this. */
    unsubscribe(peer: StorageDiffPeer, id: SubscriptionId): boolean {
        return peer.subscriptions.delete(id);
    }

    async getDiffs(
        addresses: AccountAddress[],
        fromBlock: bigint
    ): Promise<BlockStorageDiff[]> {
        return await this.enqueue(async () => {
            const head = BigInt(
                this.canonical[this.canonical.length - 1].number
            );
            if (fromBlock > head) return [];
            if (fromBlock < BigInt(this.canonical[0].number)) {
                throw rpcError(
                    PRUNED_ERROR_CODE,
                    "Requested block has been pruned"
                );
            }
            const records = this.canonical.filter(
                (record) => BigInt(record.number) >= fromBlock
            );
            return records.map((record) => filterRecord(record, addresses));
        });
    }

    private async open(): Promise<void> {
        try {
            this.upstream = await UpstreamRpcClient.connect(this.upstreamUrl, {
                onHead: () => this.wake(),
                onLost: (error) => this.fail(error)
            });
            await this.upstream.subscribeHeads();
            // Newest first by parent hashes, then traced oldest first.
            const headers = [await this.fetchHeader("latest")];
            while (
                headers.length < this.retention &&
                headers[headers.length - 1].number > 0n
            ) {
                headers.push(
                    await this.fetchHeader(
                        headers[headers.length - 1].parentHash
                    )
                );
            }
            this.canonical = await this.stage(headers.reverse());
            await this.listen();
        } catch (error) {
            const failure = new Error(this.sanitize(describeError(error)));
            await this.teardown(failure).catch(() => undefined);
            throw failure;
        }
        this.ready = true;
        if (this.wakePending) this.wake();
    }

    private async listen(): Promise<void> {
        const server = new WebSocketServer({
            host: this.host,
            port: this.port,
            maxPayload: MAX_PEER_PAYLOAD_BYTES
        });
        this.server = server;
        await new Promise<void>((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        server.on("error", (error) => this.fail(error));
        server.on("connection", (socket) => this.accept(socket));
    }

    private accept(socket: WebSocket): void {
        const peer: StorageDiffPeer = {
            socket,
            subscriptions: new Map(),
            nextSubscription: 0
        };
        const methods = new StorageDiffRpcMethods(this, peer);
        this.peers.set(socket, peer);
        socket.on("error", () => socket.terminate());
        socket.on("close", () => this.peers.delete(socket));
        socket.on("message", (data, isBinary) => {
            this.handleRpc(
                socket,
                methods,
                isBinary ? "" : data.toString()
            ).catch(() => socket.terminate());
        });
    }

    private async handleRpc(
        socket: WebSocket,
        methods: StorageDiffRpcMethods,
        raw: string
    ): Promise<void> {
        const reply = (id: unknown, code: number, message: string) =>
            this.send(socket, { jsonrpc: "2.0", id, error: { code, message } });
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
        try {
            if (!ENDPOINTS.has(request.method)) {
                throw rpcError(METHOD_NOT_FOUND, "Method not found");
            }
            if (!Array.isArray(request.params)) {
                throw rpcError(INVALID_PARAMS, "params must be an array");
            }
            const endpoint = request.method as keyof StorageDiffRpcMethods;
            const result = await methods[endpoint](request.params);
            if (!notification)
                this.send(socket, { jsonrpc: "2.0", id, result });
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

    private enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = this.queueTail.then(job);
        this.queueTail = run.catch(() => undefined);
        return run;
    }

    private request(method: string, params: unknown[]): Promise<unknown> {
        if (!this.upstream) {
            return Promise.reject(new Error("Upstream connection is not open"));
        }
        return this.upstream.request(method, params);
    }

    private async fetchHeader(
        by: "latest" | bigint | string
    ): Promise<BlockHeader> {
        const byHash = typeof by === "string" && by !== "latest";
        const block = await this.request(
            byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber",
            [typeof by === "bigint" ? toQuantity(by) : by, false]
        );
        if (block === null) {
            throw new HeadChangedError(`Block ${String(by)} is not known`);
        }
        return parseHeader(block);
    }

    private async assertCanonical(header: BlockHeader): Promise<void> {
        const current = await this.fetchHeader(header.number);
        if (current.hash !== header.hash) {
            throw new HeadChangedError(
                `Block ${header.number} changed while tracing`
            );
        }
    }

    /** Traces each header's block once, in order; empty blocks need no trace. */
    private async stage(headers: BlockHeader[]): Promise<BlockStorageDiff[]> {
        const records: BlockStorageDiff[] = [];
        for (const header of headers) {
            let diff: { pre: AccountDiffs; post: AccountDiffs } = {
                pre: {},
                post: {}
            };
            if (header.txCount > 0) {
                await this.assertCanonical(header);
                const traces = await this.request("debug_traceBlockByNumber", [
                    toQuantity(header.number),
                    TRACE_OPTIONS
                ]);
                await this.assertCanonical(header);
                if (
                    !Array.isArray(traces) ||
                    traces.length !== header.txCount
                ) {
                    throw new Error("Upstream trace does not cover the block");
                }
                diff = mergeTransactionDiffs(traces);
            }
            records.push({
                number: toQuantity(header.number),
                hash: header.hash,
                parentHash: header.parentHash,
                ...diff
            });
        }
        return records;
    }

    private send(socket: WebSocket, message: unknown): void {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(message));
    }

    private publish(record: BlockStorageDiff): void {
        for (const [socket, peer] of this.peers) {
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
            // The limit applies to the socket's aggregate buffered bytes, so a
            // catch-up reply the peer has not drained counts as well.
            // A peer that cannot keep up recovers with catch-up, not lost records.
            if (socket.bufferedAmount > MAX_PEER_BUFFERED_BYTES) {
                socket.terminate();
            }
        }
    }

    /** Moves the canonical history to the upstream's current best head. */
    private async reconcileHead(): Promise<void> {
        const canonical = this.canonical;
        let cursor = await this.fetchHeader("latest");
        const branch: BlockHeader[] = [];
        const floor = BigInt(canonical[0].number);
        let ancestor = -1;
        // Set when the common ancestor is older than the retained window.
        let below: BlockHeader | undefined;
        while (cursor.number >= floor) {
            ancestor = canonical.findIndex(
                (record) => record.hash === cursor.hash
            );
            if (ancestor >= 0) break;
            branch.push(cursor);
            if (cursor.number === 0n) throw noAncestor();
            cursor = await this.fetchHeader(cursor.parentHash);
        }
        if (cursor.number < floor) {
            // Walk the old chain down by hash, fetching only what it needs.
            let oldNumber = floor;
            let oldHash = canonical[0].hash;
            let oldParent: string | undefined = canonical[0].parentHash;
            const stepOld = async () => {
                oldParent ??= (await this.fetchHeader(oldHash)).parentHash;
                oldHash = oldParent;
                oldParent = undefined;
                oldNumber -= 1n;
            };
            while (oldNumber > cursor.number) await stepOld();
            while (oldHash !== cursor.hash) {
                branch.push(cursor);
                if (cursor.number === 0n) throw noAncestor();
                cursor = await this.fetchHeader(cursor.parentHash);
                await stepOld();
            }
            below = cursor;
        }
        branch.reverse();
        // An ancestor older than the window becomes the oldest retained record.
        const staged = await this.stage(below ? [below, ...branch] : branch);
        if (branch.length > 0) {
            await this.assertCanonical(branch[branch.length - 1]);
        }
        canonical.splice(ancestor + 1);
        canonical.push(...staged);
        canonical.splice(0, Math.max(0, canonical.length - this.retention));
        for (const record of staged.slice(below ? 1 : 0)) this.publish(record);
    }

    /** Re-resolves the head after a transient failure, with backoff. */
    private async reconcileWithRetry(): Promise<void> {
        await retry(() => this.reconcileHead(), {
            maxRetries: RECONCILE_RETRY_LIMIT,
            delayMs: RECONCILE_RETRY_BACKOFF_MS,
            useExponentialBackoff: true,
            signal: this.stopping.signal,
            shouldRetry: isTransient,
            onRetry: (attempt, error) =>
                this.logger.warn("Retrying head reconciliation", {
                    attempt,
                    reason: this.sanitize(describeError(error))
                })
        });
    }

    private wake(): void {
        if (!this.ready) {
            this.wakePending = true;
            return;
        }
        if (this.wakeQueued || this.stopping.signal.aborted) return;
        this.wakeQueued = true;
        this.enqueue(async () => {
            this.wakeQueued = false;
            await this.reconcileWithRetry();
        }).catch((error) => this.fail(error));
    }

    // The upstream URL can carry credentials: nothing may echo it.
    private sanitize(message: string): string {
        return message.split(this.upstreamUrl).join(this.upstreamEndpoint);
    }

    private fail(error: unknown): void {
        if (this.stopping.signal.aborted) return;
        const failure = new Error(this.sanitize(describeError(error)));
        this.logger.error("Storage diff service failed", {
            reason: failure.message
        });
        void this.teardown(failure);
    }

    private teardown(reason?: Error): Promise<void> {
        this.shutdown ??= (async () => {
            this.stopping.abort();
            this.upstream?.close(
                reason ?? new Error("StorageDiffService closed")
            );
            for (const socket of this.peers.keys()) socket.terminate();
            await new Promise<void>((resolve) => {
                if (!this.server) return resolve();
                this.server.close(() => resolve());
            });
            if (reason) this.settleClosed.reject(reason);
            else this.settleClosed.resolve();
        })();
        return this.shutdown;
    }
}
