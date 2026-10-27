import {
    bloomContains,
    filterRecord,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    isObject,
    mergeTransactionDiffs,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    parseHeader,
    parseLogs,
    PRUNED_ERROR_CODE,
    rpcError,
    toQuantity,
    type AccountAddress,
    type AccountDiffs,
    type BlockHeader,
    type BlockStorageDiff,
    type IncludedHeadRecord,
    type StagedBlock,
    type SubscriptionId
} from "./blockStorageDiff";
import type AIncludedHeadStrategy from "./includedHead/AIncludedHeadStrategy";
import type { IncludedHead } from "./includedHead/AIncludedHeadStrategy";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import {
    UpstreamLostError,
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
/** Reconnects to a lost upstream before the service fails. */
export const UPSTREAM_RECONNECT_LIMIT = 5;
/** Delay before the first reconnect; each further one doubles it. */
export const UPSTREAM_RECONNECT_BACKOFF_MS = 200;
export const DEFAULT_MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
/** `scp_disconnect` reason for a peer cut for falling behind. */
export const SEND_BUFFER_OVERFLOW = "send-buffer-overflow";
/** WebSocket close code for that cut: policy violation. */
export const SEND_BUFFER_OVERFLOW_CLOSE_CODE = 1008;

const MAX_PEER_PAYLOAD_BYTES = 1024 * 1024;
/** How long a cut peer gets to drain the notice before the socket drops. */
const PEER_CLOSE_GRACE_MS = 10_000;
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
    /** A peer whose unsent bytes pass this is told why and cut. */
    maxPeerBufferedBytes?: number;
    /**
     * Where the included level comes from. Without one, no included head is
     * pushed and catch-up reports `null`.
     */
    includedHead?: AIncludedHeadStrategy;
    logger: Logger;
}

/** What a catch-up answers: retained records and the included head. */
export interface StorageDiffCatchUp {
    records: BlockStorageDiff[];
    /** `null` until the strategy reported one. */
    includedHead: IncludedHeadRecord | null;
}

/** One connected peer and the subscriptions it opened. */
export interface StorageDiffPeer {
    socket: WebSocket;
    subscriptions: Map<SubscriptionId, AccountAddress[]>;
    nextSubscription: number;
    /** Cut for falling behind; gets nothing more. */
    closing: boolean;
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
 * ends a subscription. Two levels: records are the `latest` level (best head,
 * may roll back); the included head, reported by an `AIncludedHeadStrategy`, is
 * the level the chain treats as final. It is pushed as `scp_includedHead` and
 * returned by catch-up. A record carries the logs of the subscribed addresses
 * its header bloom matches, fetched once per block with `eth_getLogs` by block hash.
 * A reorg or an upstream error answer or timeout during startup or
 * reconciliation is retried, and a lost upstream socket is reconnected (during
 * startup too), then reconciled from the last canonical record. A failure that
 * outlasts its retries is fatal: a supervisor restarts the process and
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
    private readonly maxPeerBufferedBytes: number;
    private readonly includedStrategy?: AIncludedHeadStrategy;
    private readonly peers = new Map<WebSocket, StorageDiffPeer>();
    private readonly stopping = new AbortController();
    private upstream?: UpstreamRpcClient;
    private server?: WebSocketServer;
    private canonical: StagedBlock[] = [];
    private included?: IncludedHead;
    // Hash of the included head already reported as off the best chain.
    private divergenceReported?: string;
    // The upstream dropped while the service was starting.
    private lostBeforeReady = false;
    // One serialized queue: reconciliation commits branches in order, and
    // subscriptions and catch-up reads see a consistent canonical history.
    private queueTail: Promise<unknown> = Promise.resolve();
    private ready = false;
    private wakePending = false;
    private wakeQueued = false;
    private reconnecting = false;
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
        this.includedStrategy = options.includedHead;
        this.upstreamUrl = options.upstreamUrl;
        this.upstreamEndpoint = upstreamEndpoint;
        this.host = options.host ?? "127.0.0.1";
        this.port = options.port ?? DEFAULT_PORT;
        this.retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        this.maxPeerBufferedBytes =
            options.maxPeerBufferedBytes ?? DEFAULT_MAX_PEER_BUFFERED_BYTES;
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
        const limit = options.maxPeerBufferedBytes;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
            throw new Error("maxPeerBufferedBytes must be a positive integer");
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
    ): Promise<StorageDiffCatchUp> {
        return await this.enqueue(async () => {
            const includedHead = this.includedRecord();
            const head = BigInt(
                this.canonical[this.canonical.length - 1].number
            );
            if (fromBlock > head) return { records: [], includedHead };
            if (fromBlock < BigInt(this.canonical[0].number)) {
                throw rpcError(
                    PRUNED_ERROR_CODE,
                    "Requested block has been pruned"
                );
            }
            const blocks = this.canonical.filter(
                (record) => BigInt(record.number) >= fromBlock
            );
            // Logs of blocks staged before anyone subscribed to these addresses.
            for (const block of blocks) {
                await this.retryTransient(
                    () => this.attachLogs(block, addresses),
                    "Retrying the log fetch"
                );
            }
            return {
                records: blocks.map((record) =>
                    filterRecord(record, addresses)
                ),
                includedHead
            };
        });
    }

    /**
     * Applies the included head the strategy reported: later than the current
     * one only. Subscribed peers get it pushed.
     */
    advanceIncluded(head: IncludedHead): Promise<void> {
        return this.enqueue(async () => {
            if (this.included && head.number <= this.included.number) return;
            this.included = head;
            this.checkIncludedAncestry();
            const record = this.includedRecord();
            for (const peer of this.peers.values()) {
                if (peer.closing || peer.subscriptions.size === 0) continue;
                this.send(peer.socket, {
                    jsonrpc: "2.0",
                    method: "scp_includedHead",
                    params: record
                });
                this.dropIfLagging(peer);
            }
        });
    }

    private async open(): Promise<void> {
        try {
            // The upstream can drop during the load as well as after startup.
            let connected = false;
            this.canonical = await retry(
                async () => {
                    connected = false;
                    await this.connectUpstream();
                    connected = true;
                    this.lostBeforeReady = false;
                    return await this.retryTransient(
                        () => this.loadHistory(),
                        "Retrying the initial history load"
                    );
                },
                {
                    maxRetries: UPSTREAM_RECONNECT_LIMIT,
                    delayMs: UPSTREAM_RECONNECT_BACKOFF_MS,
                    useExponentialBackoff: true,
                    signal: this.stopping.signal,
                    // A failed connect has its own retries.
                    shouldRetry: (error) =>
                        connected && error instanceof UpstreamLostError,
                    onRetry: (attempt, error) =>
                        this.logger.warn(
                            "Retrying startup after the upstream dropped",
                            {
                                attempt,
                                reason: this.sanitize(describeError(error))
                            }
                        )
                }
            );
            await this.includedStrategy?.start({
                logger: this.logger,
                request: (method, params) => this.request(method, params),
                advance: (head) => this.advanceIncluded(head),
                fail: (error) => this.fail(error)
            });
            await this.listen();
        } catch (error) {
            const failure = new Error(this.sanitize(describeError(error)));
            await this.teardown(failure).catch(() => undefined);
            throw failure;
        }
        this.ready = true;
        if (this.lostBeforeReady) this.reconnect();
        if (this.wakePending) this.wake();
    }

    /** The last `retention` canonical blocks, oldest first. */
    private async loadHistory(): Promise<StagedBlock[]> {
        // Newest first by parent hashes, then traced oldest first.
        const headers = [await this.fetchHeader("latest")];
        while (
            headers.length < this.retention &&
            headers[headers.length - 1].number > 0n
        ) {
            headers.push(
                await this.fetchHeader(headers[headers.length - 1].parentHash)
            );
        }
        return await this.stage(headers.reverse());
    }

    /** Opens the upstream and its head subscription, with bounded retries. */
    private async connectUpstream(): Promise<void> {
        const client = await retry(
            async () => {
                const attempt = await UpstreamRpcClient.connect(
                    this.upstreamUrl,
                    {
                        // Before the service is ready, the failing request
                        // reports the loss to `open`.
                        onLost: () =>
                            this.ready
                                ? this.reconnect()
                                : (this.lostBeforeReady = true)
                    }
                );
                try {
                    await attempt.subscribeHeads(() => this.wake());
                } catch (error) {
                    attempt.close(new UpstreamLostError("Subscription failed"));
                    throw error;
                }
                return attempt;
            },
            {
                maxRetries: UPSTREAM_RECONNECT_LIMIT,
                delayMs: UPSTREAM_RECONNECT_BACKOFF_MS,
                useExponentialBackoff: true,
                signal: this.stopping.signal,
                shouldRetry: (error) =>
                    error instanceof UpstreamLostError || isTransient(error),
                onRetry: (attempt, error) =>
                    this.logger.warn("Retrying the upstream connection", {
                        attempt,
                        reason: this.sanitize(describeError(error))
                    })
            }
        );
        if (this.stopping.signal.aborted) {
            client.close(new Error("StorageDiffService closed"));
            throw new Error("StorageDiffService closed");
        }
        this.upstream = client;
    }

    /** Replaces a lost upstream, then reconciles from the last record. */
    private reconnect(): void {
        if (this.reconnecting || this.stopping.signal.aborted) return;
        this.reconnecting = true;
        this.upstream = undefined;
        this.logger.warn("Upstream connection lost; reconnecting");
        this.connectUpstream().then(
            () => {
                this.reconnecting = false;
                this.wake();
            },
            (error) => this.fail(error)
        );
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
            nextSubscription: 0,
            closing: false
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
            return Promise.reject(
                new UpstreamLostError("Upstream connection is not open")
            );
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
    private async stage(headers: BlockHeader[]): Promise<StagedBlock[]> {
        const records: StagedBlock[] = [];
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
            const record: StagedBlock = {
                number: toQuantity(header.number),
                hash: header.hash,
                parentHash: header.parentHash,
                ...diff,
                logs: [],
                logsBloom: header.logsBloom,
                loggedAddresses: new Set()
            };
            await this.attachLogs(record, this.subscribedAddresses());
            records.push(record);
        }
        return records;
    }

    /** Every address some open subscription asks for. */
    private subscribedAddresses(): AccountAddress[] {
        const addresses = new Set<AccountAddress>();
        for (const peer of this.peers.values()) {
            for (const list of peer.subscriptions.values()) {
                for (const address of list) addresses.add(address);
            }
        }
        return [...addresses];
    }

    /**
     * Fetches the block's logs of the `addresses` its header bloom matches and
     * that it holds none for yet: one `eth_getLogs` by block hash, none when
     * nothing matches. The bloom comes with the header the service already
     * fetched, so the test costs no request.
     */
    private async attachLogs(
        block: StagedBlock,
        addresses: AccountAddress[]
    ): Promise<void> {
        const missing = addresses.filter(
            (address) =>
                !block.loggedAddresses.has(address) &&
                bloomContains(block.logsBloom, address)
        );
        if (missing.length === 0) return;
        const answer = await this.request("eth_getLogs", [
            { blockHash: block.hash, address: missing }
        ]);
        const fetched = parseLogs(answer).filter((log) =>
            missing.includes(log.address)
        );
        for (const address of missing) block.loggedAddresses.add(address);
        block.logs = [...block.logs, ...fetched].sort((a, b) =>
            Number(BigInt(a.logIndex) - BigInt(b.logIndex))
        );
    }

    private send(socket: WebSocket, message: unknown): void {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(message));
    }

    private publish(record: StagedBlock): void {
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
        const head = canonical[canonical.length - 1];
        this.checkIncludedAncestry();
        this.includedStrategy?.bestHeadCommitted({
            number: BigInt(head.number),
            hash: head.hash
        });
    }

    /**
     * The included head belongs to the best chain. A retained block of its
     * number with another hash means it does not: an early reorg warning,
     * which is only logged. A head outside the retained window cannot be
     * judged here.
     */
    private checkIncludedAncestry(): void {
        const included = this.included;
        if (!included) return;
        const best = this.canonical.find(
            (record) => BigInt(record.number) === included.number
        );
        if (
            !best ||
            best.hash === included.hash ||
            this.divergenceReported === included.hash
        ) {
            return;
        }
        this.divergenceReported = included.hash;
        this.logger.warn("Included head is not an ancestor of the best head", {
            includedNumber: toQuantity(included.number),
            includedHash: included.hash,
            bestHash: best.hash
        });
    }

    private includedRecord(): IncludedHeadRecord | null {
        return this.included
            ? {
                  number: toQuantity(this.included.number),
                  hash: this.included.hash
              }
            : null;
    }

    /** Runs `job` again after a transient failure, with backoff. */
    private async retryTransient<T>(
        job: () => Promise<T>,
        message: string
    ): Promise<T> {
        return await retry(job, {
            maxRetries: RECONCILE_RETRY_LIMIT,
            delayMs: RECONCILE_RETRY_BACKOFF_MS,
            useExponentialBackoff: true,
            signal: this.stopping.signal,
            shouldRetry: isTransient,
            onRetry: (attempt, error) =>
                this.logger.warn(message, {
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
            await this.retryTransient(
                () => this.reconcileHead(),
                "Retrying head reconciliation"
            );
        }).catch((error) => {
            // A lost upstream is reconnected; the reconnect wakes again.
            if (error instanceof UpstreamLostError) return;
            this.fail(error);
        });
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
            this.includedStrategy?.close();
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
