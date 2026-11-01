import type ABackfillBlockSource from "./backfillBlocks/ABackfillBlockSource";
import { ListedBlockSource } from "./backfillBlocks/ListedBlockSource";
import {
    bloomContains,
    environmentOf,
    filterRecord,
    hasRevertedFrame,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    isObject,
    mergeTransactionDiffs,
    touchesOf,
    METHOD_NOT_FOUND,
    NOT_RETAINED_ERROR_CODE,
    PARSE_ERROR,
    parseHeader,
    parseLogs,
    type ParsedBlockSelector,
    PRUNED_ERROR_CODE,
    rpcError,
    type AccountAddress,
    type AccountDiffs,
    type BlockEnvironment,
    type BlockHeader,
    type BlockTouches,
    type IncludedHeadRecord,
    type RpcBlock,
    type StagedBlock,
    type StateRequest,
    type StorageSlot,
    type SnapshotStatus,
    type SubscribeResult,
    type SubscriptionId
} from "./blockStorageDiff";
import {
    ChainMovedError,
    ContractBackfill,
    type BackfilledState,
    type BackfillCost
} from "./ContractBackfill";
import { HeadWaiters } from "./HeadWaiters";
import type AIncludedHeadStrategy from "./includedHead/AIncludedHeadStrategy";
import type { IncludedHead } from "./includedHead/AIncludedHeadStrategy";
import { PersistedCache } from "./PersistedCache";
import {
    fieldKey,
    normalizeBalance,
    StateCache,
    type FieldKey,
    type StateField,
    type StateValue
} from "./StateCache";
import { StateStore } from "./StateStore";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import {
    UpstreamLostError,
    UpstreamRequestError,
    UpstreamRpcClient,
    UpstreamTimeoutError
} from "./UpstreamRpcClient";
import type {
    StorageDiffCatchUp,
    StorageDiffDelayNotice,
    StorageDiffState
} from "../../storageDiff/storageDiffWire";
import type { Logger } from "@/utils";
import { retry } from "@/utils/retry";
import { toQuantity } from "ethers";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

const DEFAULT_RETENTION_BLOCKS = 128;
export type { StorageDiffCatchUp, StorageDiffState };

/** Retries of a failed head reconciliation before the service fails. */
export const RECONCILE_RETRY_LIMIT = 3;
/** Delay before the first retry; each further retry doubles it. */
export const RECONCILE_RETRY_BACKOFF_MS = 250;
/** Reconnects to a lost upstream before the service fails. */
export const UPSTREAM_RECONNECT_LIMIT = 5;
/** Delay before the first reconnect; each further one doubles it. */
export const UPSTREAM_RECONNECT_BACKOFF_MS = 200;
const DEFAULT_MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
/** `scp_disconnect` reason for a peer cut for falling behind. */
export const SEND_BUFFER_OVERFLOW = "send-buffer-overflow";
/** WebSocket close code for that cut: policy violation. */
export const SEND_BUFFER_OVERFLOW_CLOSE_CODE = 1008;

/** Rounds a backfill may take to catch up with a head that keeps moving. */
const BACKFILL_ROUNDS = 100;
/** Times a backfill starts over after a reorg moved blocks under it. */
const BACKFILL_RESTARTS = 5;
const MAX_PEER_PAYLOAD_BYTES = 1024 * 1024;
/** How long a cut peer gets to drain the notice before the socket drops. */
const PEER_CLOSE_GRACE_MS = 10_000;
const DEFAULT_PORT = 19778;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

const CALL_TRACE_OPTIONS = { tracer: "callTracer" };

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
    /**
     * Where a backfill learns which blocks to trace. Defaults to listing every
     * block of the range, which suits dev chains.
     */
    backfillBlocks?: ABackfillBlockSource;
    /**
     * Directory the cache is kept in, so a restart resumes from the saved head.
     * Without one the cache lives in memory only.
     */
    cacheDir?: string;
    logger: Logger;
}

/** What one contract's backfill cost and found. */
export interface BackfillRecord extends BackfillCost {
    address: AccountAddress;
    /** Block the contract's code first appears at; undefined for an account without code. */
    deployBlock?: string;
    /** Blocks listed, and how many of them were traced. */
    blocks: number;
    tracedBlocks: number;
    /** Slots found written. */
    slots: number;
    /** Requests of the final balance, nonce and code read. */
    stateReads: number;
    milliseconds: number;
}

/** One connected peer and the subscriptions it opened. */
export interface StorageDiffPeer {
    socket: WebSocket;
    subscriptions: Map<SubscriptionId, AccountAddress[]>;
    nextSubscription: number;
    /** Cut for falling behind; gets nothing more. */
    closing: boolean;
    /** Accounts whose snapshot this peer has been sent. */
    snapshotted: Set<AccountAddress>;
    /** Accounts a subscription reply promised as `ready` whose snapshot is not sent yet. */
    promisedReady: Set<AccountAddress>;
    /** Per subscription, run once the reply that returned its id is sent. */
    afterReply: Map<SubscriptionId, () => void>;
}

/** Identifies one state fetch in flight: a `StateField` as text. */
type FlightKey = string;

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
    private readonly backfillBlocks: ABackfillBlockSource;
    private readonly peers = new Map<WebSocket, StorageDiffPeer>();
    private readonly stopping = new AbortController();
    private upstream?: UpstreamRpcClient;
    private server?: WebSocketServer;
    private canonical: StagedBlock[] = [];
    // Account and slot values at the best head; every upstream read fills it.
    private readonly stateCache = new StateCache();
    // One fetch per missing field, shared by every reader waiting for it.
    private readonly flights = new Map<FlightKey, Promise<void>>();
    private included?: IncludedHead;
    // Hash of the included head already reported as off the best chain.
    private divergenceReported?: string;
    // Accounts the service keeps the values of in every record it stages: one
    // entry per account, settled when the retained records hold them too.
    private readonly watched = new Map<AccountAddress, Promise<void>>();
    // Backfills in flight, one per account.
    private readonly backfills = new Map<AccountAddress, Promise<void>>();
    // Accounts whose backfill found fewer entries than the chain holds: read lazily, not backfilled again.
    private readonly lazyAccounts = new Set<AccountAddress>();
    private readonly persisted?: PersistedCache;
    private readonly headWaiters: HeadWaiters;
    // Whether the upstream answers eth_getBlockReceipts; one failed call turns it off.
    private blockReceiptsSupported = true;
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
        this.backfillBlocks = options.backfillBlocks ?? new ListedBlockSource();
        if (options.cacheDir)
            this.persisted = new PersistedCache({
                store: new StateStore(options.cacheDir),
                stateCache: this.stateCache,
                watched: this.watched,
                logger: this.logger,
                stopping: this.stopping.signal,
                canonical: () => this.canonical,
                failureReason: (error) => this.failureReason(error),
                retainedIndex: (blockHash) => this.retainedIndex(blockHash),
                fetchHeader: (by) => this.fetchHeader(by),
                stage: (headers, preFrom) => this.stage(headers, preFrom)
            });
        this.upstreamUrl = options.upstreamUrl;
        this.upstreamEndpoint = upstreamEndpoint;
        this.host = options.host ?? "127.0.0.1";
        this.port = options.port ?? DEFAULT_PORT;
        this.retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        this.maxPeerBufferedBytes =
            options.maxPeerBufferedBytes ?? DEFAULT_MAX_PEER_BUFFERED_BYTES;
        this.headWaiters = new HeadWaiters({
            headNumber: () => this.headNumber(),
            bestHead: () => this.canonical[this.canonical.length - 1],
            request: (method, params) => this.request(method, params),
            noteDelay: (notice) => this.noteDelay(notice)
        });
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
    ): Promise<SubscribeResult> {
        return await this.enqueue(async () => {
            if (!this.peers.has(peer.socket)) throw new Error("Peer closed");
            const id = "0x" + (++peer.nextSubscription).toString(16);
            peer.subscriptions.set(id, addresses);
            // after the reply: the peer learns the id before the snapshots
            peer.afterReply.set(id, () => {
                void this.enqueue(async () => {
                    this.sendSnapshots(peer, addresses);
                    for (const address of addresses)
                        this.startBackfill(address);
                });
            });
            // the records keep these accounts' values from the next block on
            for (const address of addresses) void this.watch(address);
            const accounts = Object.fromEntries(
                addresses.map((address): [AccountAddress, SnapshotStatus] => [
                    address,
                    this.lazyAccounts.has(address)
                        ? "lazy"
                        : this.stateCache.isComplete(address)
                          ? "ready"
                          : "syncing"
                ])
            );
            for (const [address, status] of Object.entries(accounts))
                if (status === "ready" && !peer.snapshotted.has(address))
                    peer.promisedReady.add(address);
            return { subscription: id, accounts };
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
        // the records hold the requested accounts, filled in if need be
        await Promise.all(addresses.map((address) => this.watch(address)));
        return await this.enqueue(async () => {
            const includedHead = this.includedRecord();
            const best = this.canonical[this.canonical.length - 1];
            const head = BigInt(best.number);
            const environment = environmentOf(best);
            if (fromBlock > head) {
                return { records: [], includedHead, head: environment };
            }
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
                includedHead,
                head: environment
            };
        });
    }

    /**
     * The values of the requested fields at retained block `blockHash`.
     * A field missing from the cache is fetched from the upstream once, at the
     * best head, however many readers wait for it; an older block is answered
     * by undoing the later blocks' writes with their `pre` values.
     */
    async getState(
        blockHash: string,
        requests: StateRequest[]
    ): Promise<StorageDiffState> {
        const fields = requests.flatMap((request) => this.fieldsOf(request));
        // the records hold the requested accounts, which a value read needs
        await Promise.all(
            requests.map((request) => this.watch(request.address))
        );
        for (let attempt = 0; attempt <= RECONCILE_RETRY_LIMIT; attempt++) {
            this.assertRetained(blockHash);
            this.fetchMissing(fields);
            await Promise.all(fields.map((field) => this.ensureCached(field)));
            // Synchronous from here: the cache and the chain agree.
            const index = this.retainedIndex(blockHash);
            if (index < 0) continue;
            const heads = fields.map((field) => this.stateCache.get(field));
            if (heads.some((value) => value === undefined)) continue;
            const scratch = new StateCache();
            fields.forEach((field, i) => scratch.set(field, heads[i]!));
            for (let i = this.canonical.length - 1; i > index; i--) {
                scratch.applyBackward(this.canonical[i]);
            }
            const block = this.canonical[index];
            return {
                number: block.number,
                hash: block.hash,
                accounts: this.accountsOf(requests, fields, scratch)
            };
        }
        throw new HeadChangedError("The chain moved while state was read");
    }

    /**
     * A retained block as the upstream returned it, with full or hashed
     * transactions; null when the block is not retained.
     */
    async getBlock(
        selector: ParsedBlockSelector,
        full: boolean,
        minBlock?: bigint
    ): Promise<RpcBlock | null> {
        await this.headWaiters.reach(minBlock);
        const record =
            selector.kind === "latest"
                ? this.canonical[this.canonical.length - 1]
                : this.canonical.find((candidate) =>
                      selector.kind === "hash"
                          ? candidate.hash === selector.hash
                          : BigInt(candidate.number) === selector.number
                  );
        if (!record) return null;
        if (full) return record.raw;
        return {
            ...record.raw,
            transactions: record.raw.transactions.map(
                (transaction) => (transaction as { hash: string }).hash
            )
        };
    }

    /** A transaction of a retained block, as the upstream returned it. */
    async getTransaction(hash: string, minBlock?: bigint): Promise<unknown> {
        await this.headWaiters.reach(minBlock);
        return this.findTransaction(hash)?.transaction ?? null;
    }

    /**
     * The receipt of a transaction of a retained block. The block's receipts
     * are fetched from the upstream once, on the first read of any of them.
     */
    async getTransactionReceipt(
        hash: string,
        minBlock?: bigint
    ): Promise<unknown> {
        await this.headWaiters.reach(minBlock);
        const found = this.findTransaction(hash);
        if (!found) return null;
        const { block, transaction } = found;
        block.receipts ??= this.fetchReceipts(block).catch((error) => {
            block.receipts = undefined;
            throw error;
        });
        const receipts = await block.receipts;
        return (
            receipts.find(
                (receipt) =>
                    (receipt as { transactionHash?: string })
                        .transactionHash === transaction.hash
            ) ?? null
        );
    }

    /** The environment of the best head, once it reaches `minBlock` if one is named. */
    async getHead(minBlock?: bigint): Promise<BlockEnvironment> {
        await this.headWaiters.reach(minBlock);
        return environmentOf(this.canonical[this.canonical.length - 1]);
    }

    /** The number of the best head. */
    private headNumber(): bigint {
        return BigInt(this.canonical[this.canonical.length - 1].number);
    }

    /**
     * Ends the waits the notice makes pointless and pushes it to the
     * subscribed peers. A block that fails to trace holds back every block
     * after it, so it ends every wait; an upstream that has not seen block N
     * ends the waits for N or later.
     */
    private noteDelay(notice: StorageDiffDelayNotice): void {
        this.headWaiters.endForDelay(notice);
        for (const peer of this.peers.values()) {
            if (peer.closing || peer.subscriptions.size === 0) continue;
            this.pushDelay(peer, notice);
        }
    }

    private pushDelay(
        peer: StorageDiffPeer,
        notice: StorageDiffDelayNotice
    ): void {
        this.send(peer.socket, {
            jsonrpc: "2.0",
            method: "scp_delayed",
            params: notice
        });
        this.dropIfLagging(peer);
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
            const saved = await this.persisted?.restore();
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
                                reason: this.failureReason(error)
                            }
                        )
                }
            );
            await this.persisted?.align(saved);
            await this.includedStrategy?.start({
                logger: this.logger,
                request: (method, params) => this.request(method, params),
                advance: (head) => this.advanceIncluded(head),
                fail: (error) => this.fail(error)
            });
            await this.listen();
        } catch (error) {
            const failure = new Error(this.failureReason(error));
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
        return await this.stage(headers.reverse(), "chain");
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
                        reason: this.failureReason(error)
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
            closing: false,
            snapshotted: new Set(),
            promisedReady: new Set(),
            afterReply: new Map()
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
            const peer = this.peers.get(socket);
            // only the reply that carries the id may release its job; another
            // request's reply could land before this one is sent
            const subscription = isObject(result)
                ? result.subscription
                : undefined;
            if (peer && typeof subscription === "string") {
                const job = peer.afterReply.get(subscription);
                peer.afterReply.delete(subscription);
                job?.();
            }
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
            // full transactions: the service serves the block as the node does
            [typeof by === "bigint" ? toQuantity(by) : by, true]
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

    /**
     * Traces each header's block once, in order; empty blocks need no trace.
     * The trace names what the block touched; the values of what the watched
     * accounts touched are read from the node, never taken from the trace.
     * `pre` values come from the cache when the cache is at the parent of the
     * first block (`preFrom` "cache"), carried forward block by block over
     * what the staged blocks read; from the node at the parent block otherwise.
     */
    private async stage(
        headers: BlockHeader[],
        preFrom: "cache" | "chain"
    ): Promise<StagedBlock[]> {
        const progress: { header?: BlockHeader } = {};
        try {
            return await this.stageHeaders(headers, preFrom, progress);
        } catch (error) {
            // the peers waiting for this block, or one after it, need not wait for it
            const { header } = progress;
            if (header)
                this.noteDelay({
                    reason: "trace-failed",
                    block: {
                        number: toQuantity(header.number),
                        hash: header.hash
                    }
                });
            throw error;
        }
    }

    private async stageHeaders(
        headers: BlockHeader[],
        preFrom: "cache" | "chain",
        progress: { header?: BlockHeader }
    ): Promise<StagedBlock[]> {
        const records: StagedBlock[] = [];
        // the value each field has after the blocks staged so far
        const running = new Map<FieldKey, StateValue>();
        for (const header of headers) {
            progress.header = header;
            let touches: BlockTouches = {};
            // the trace's values stand for a block in which no call frame failed
            let trusted: { pre: AccountDiffs; post: AccountDiffs } | undefined;
            if (header.txCount > 0) {
                const { traces, calls } = await this.traceBlock(header.number);
                // the trace is of this block only if it is still the one at its number
                await this.assertCanonical(header);
                if (
                    !Array.isArray(traces) ||
                    traces.length !== header.txCount
                ) {
                    throw new Error("Upstream trace does not cover the block");
                }
                touches = touchesOf(traces);
                if (!hasRevertedFrame(calls, header.txCount))
                    trusted = mergeTransactionDiffs(traces);
            }
            const record: StagedBlock = {
                ...environmentOf({
                    ...header,
                    number: toQuantity(header.number)
                }),
                parentHash: header.parentHash,
                pre: {},
                post: {},
                touches,
                covered: new Set(),
                raw: header.raw,
                logs: [],
                logsBloom: header.logsBloom,
                loggedAddresses: new Set()
            };
            if (trusted) {
                record.covered = "all";
                this.takeTraceValues(record, trusted, running);
            } else {
                const addresses = [...this.watched.keys()];
                for (const address of addresses)
                    (record.covered as Set<AccountAddress>).add(address);
                await this.readValues(record, addresses, preFrom, running);
            }
            await this.attachLogs(record, this.subscribedAddresses());
            records.push(record);
        }
        return records;
    }

    /**
     * The block's `prestateTracer` diff and its `callTracer` frames, asked for
     * in one batch. A `callTracer` answer that is an error is `undefined`: the
     * caller then reads values from the node.
     */
    private async traceBlock(
        number: bigint
    ): Promise<{ traces: unknown; calls: unknown }> {
        if (!this.upstream)
            throw new UpstreamLostError("Upstream connection is not open");
        const [traces, calls] = this.upstream.requestBatch([
            {
                method: "debug_traceBlockByNumber",
                params: [toQuantity(number), TRACE_OPTIONS]
            },
            {
                method: "debug_traceBlockByNumber",
                params: [toQuantity(number), CALL_TRACE_OPTIONS]
            }
        ]);
        const frames = calls.catch(() => undefined);
        return { traces: await traces, calls: await frames };
    }

    /**
     * Keeps the trace's own values of every account it names in `record`, for
     * a block in which no call frame failed, so an account watched later finds
     * its history in memory, and carries them into `running` for the blocks
     * after it in the step.
     */
    private takeTraceValues(
        record: StagedBlock,
        trace: { pre: AccountDiffs; post: AccountDiffs },
        running: Map<FieldKey, StateValue>
    ): void {
        record.pre = trace.pre;
        record.post = trace.post;
        for (const [address, post] of Object.entries(trace.post)) {
            for (const kind of ["balance", "nonce", "code"] as const)
                if (post[kind] !== undefined)
                    running.set(fieldKey({ kind, address }), post[kind]!);
            for (const [slot, word] of Object.entries(post.storage ?? {}))
                running.set(fieldKey({ kind: "slot", address, slot }), word);
        }
    }

    /**
     * Reads, in one batch, the values `addresses` have at `record`'s block for
     * what the block touched of them, and the values before it, and keeps what
     * changed in `record.pre` and `record.post`.
     */
    private async readValues(
        record: StagedBlock,
        addresses: AccountAddress[],
        preFrom: "cache" | "chain",
        running = new Map<FieldKey, StateValue>()
    ): Promise<void> {
        const fields: StateField[] = [];
        for (const address of addresses) {
            const touched = record.touches[address];
            if (!touched) continue;
            for (const slot of touched.slots)
                fields.push({ kind: "slot", address, slot });
            for (const kind of ["balance", "nonce", "code"] as const)
                if (touched.changed[kind]) fields.push({ kind, address });
        }
        if (fields.length === 0 || !this.upstream) return;
        // a block before this one in the step read the field; else the cache is at the step's parent
        const before = fields.map(
            (field) =>
                running.get(fieldKey(field)) ??
                (preFrom === "cache" ? this.stateCache.get(field) : undefined)
        );
        const calls = fields.map((field) => this.fieldCall(field, record.hash));
        fields.forEach((field, i) => {
            if (before[i] === undefined)
                calls.push(this.fieldCall(field, record.parentHash));
        });
        let answers: unknown[];
        try {
            answers = await this.retryTransient(
                () => Promise.all(this.upstream!.requestBatch(calls)),
                "Retrying the block's value reads"
            );
        } catch (error) {
            // a block the node dropped cannot be read by hash: the head moved
            if (error instanceof UpstreamRequestError)
                throw new HeadChangedError(
                    `Block ${record.number} could not be read`
                );
            throw error;
        }
        let next = fields.length;
        fields.forEach((field, i) => {
            const post = this.parseField(field, answers[i]);
            running.set(fieldKey(field), post);
            const pre =
                before[i] ?? this.parseField(field, answers[next++ as number]);
            if (post === pre) return;
            for (const [side, value] of [
                [record.pre, pre],
                [record.post, post]
            ] as const) {
                const account = (side[field.address] ??= {});
                if (field.kind === "slot")
                    (account.storage ??= {})[field.slot] = value as string;
                else if (field.kind === "nonce")
                    account.nonce = value as number;
                else account[field.kind] = value as string;
            }
        });
    }

    /**
     * Starts keeping the values of `address` in every record, and fills the
     * retained records staged before. Settles when they hold it; asking again
     * returns the same promise.
     */
    private watch(address: AccountAddress): Promise<void> {
        let filled = this.watched.get(address);
        if (!filled) {
            // later blocks cover it from here; the fill covers the earlier ones
            filled = this.enqueue(() => this.fillHistory(address));
            this.watched.set(address, filled);
            filled.catch(() => this.watched.delete(address));
        }
        return filled;
    }

    /** Adds `address` to the retained records that were staged without it. */
    private async fillHistory(address: AccountAddress): Promise<void> {
        for (const record of this.canonical) {
            if (record.covered === "all" || record.covered.has(address))
                continue;
            await this.readValues(record, [address], "chain");
            record.covered.add(address);
        }
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
            // the parent is retained: its record is the ancestor, no fetch
            ancestor = canonical.findIndex(
                (record) => record.hash === cursor.parentHash
            );
            if (ancestor >= 0) break;
            cursor = await this.fetchHeader(cursor.parentHash);
        }
        if (ancestor < 0 && cursor.number < floor) {
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
        // A traced block was checked after its trace; an empty tip is not
        // rechecked: a reorg during staging wakes a new reconciliation.
        const staged = await this.stage(
            below ? [below, ...branch] : branch,
            // the cache is at the first block's parent when the branch extends the head
            !below && ancestor === canonical.length - 1 ? "cache" : "chain"
        );
        // Cached values follow the chain: back over the orphans, then forward.
        if (below) {
            this.stateCache.clear();
            this.lazyAccounts.clear();
            // nothing is complete now: peers get new snapshots after new backfills
            for (const peer of this.peers.values()) {
                this.noteSnapshotsDelayed(peer, [
                    ...peer.snapshotted,
                    ...peer.promisedReady
                ]);
                peer.snapshotted.clear();
            }
            for (const address of this.subscribedAddresses())
                this.startBackfill(address);
        } else {
            for (let i = canonical.length - 1; i > ancestor; i--) {
                this.stateCache.applyBackward(canonical[i]);
            }
        }
        canonical.splice(ancestor + 1);
        canonical.push(...staged);
        // complete accounts a block wrote, with the entries the cache holds after it
        const written: {
            address: AccountAddress;
            block: StagedBlock;
            cached: number;
        }[] = [];
        for (const record of staged.slice(below ? 1 : 0)) {
            this.stateCache.applyForward(record);
            for (const address of Object.keys(record.post))
                if (this.stateCache.isComplete(address))
                    written.push({
                        address,
                        block: record,
                        cached: this.stateCache.nonZeroSlots(address)
                    });
        }
        canonical.splice(0, Math.max(0, canonical.length - this.retention));
        for (const record of staged.slice(below ? 1 : 0)) this.publish(record);
        this.headWaiters.endReached();
        this.persisted?.scheduleSave();
        void this.verifyEntryCounts(written);
        const head = canonical[canonical.length - 1];
        this.checkIncludedAncestry();
        this.includedStrategy?.bestHeadCommitted({
            number: BigInt(head.number),
            hash: head.hash
        });
    }

    /**
     * Counts, on the chain, the storage entries of each complete account a
     * block wrote and compares them with what the cache holds after that
     * block (a source that cannot count never refuses). An account that
     * differs stays lazy from then on, as after a backfill that came up short.
     */
    private async verifyEntryCounts(
        written: {
            address: AccountAddress;
            block: StagedBlock;
            cached: number;
        }[]
    ): Promise<void> {
        await Promise.all(
            written.map(async ({ address, block, cached }) => {
                try {
                    const held = await this.backfillBlocks.countStorageEntries(
                        address,
                        { number: BigInt(block.number) }
                    );
                    if (held === undefined || held === cached) return;
                    await this.enqueue(async () => {
                        // a reorg may have dropped the block, or the account been demoted
                        if (
                            this.retainedIndex(block.hash) < 0 ||
                            !this.stateCache.isComplete(address)
                        )
                            return;
                        this.logger.warn(
                            "A block's write left fewer storage entries cached than the chain holds; the account stays lazy",
                            {
                                address,
                                block: block.number,
                                cached,
                                onChain: held
                            }
                        );
                        this.stateCache.markLazy(address);
                        this.lazyAccounts.add(address);
                        for (const peer of this.peers.values()) {
                            peer.snapshotted.delete(address);
                            if (!peer.closing)
                                this.sendSnapshots(peer, [address]);
                        }
                    });
                } catch (error) {
                    if (!this.stopping.signal.aborted)
                        this.logger.warn("Cannot count an account's entries", {
                            address,
                            reason: this.failureReason(error)
                        });
                }
            })
        );
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

    private findTransaction(
        hash: string
    ): { block: StagedBlock; transaction: { hash: string } } | undefined {
        for (let i = this.canonical.length - 1; i >= 0; i--) {
            const block = this.canonical[i];
            const transaction = (
                block.raw.transactions as { hash: string }[]
            ).find((candidate) => candidate.hash.toLowerCase() === hash);
            if (transaction) return { block, transaction };
        }
        return undefined;
    }

    /** One `eth_getBlockReceipts`, or one batch of receipt reads where the node lacks it. */
    private async fetchReceipts(block: StagedBlock): Promise<unknown[]> {
        const transactions = block.raw.transactions as { hash: string }[];
        if (this.blockReceiptsSupported) {
            try {
                const receipts = await this.request("eth_getBlockReceipts", [
                    block.hash
                ]);
                if (
                    !Array.isArray(receipts) ||
                    receipts.length !== transactions.length
                )
                    throw new Error("Receipts do not cover the block");
                return receipts;
            } catch (error) {
                if (!(error instanceof UpstreamRequestError)) throw error;
                this.blockReceiptsSupported = false;
            }
        }
        const answers = this.upstream
            ? this.upstream.requestBatch(
                  transactions.map((transaction) => ({
                      method: "eth_getTransactionReceipt",
                      params: [transaction.hash]
                  }))
              )
            : [];
        return await Promise.all(answers);
    }

    private assertRetained(blockHash: string): void {
        if (this.retainedIndex(blockHash) < 0) {
            throw rpcError(NOT_RETAINED_ERROR_CODE, "Block is not retained");
        }
    }

    private retainedIndex(blockHash: string): number {
        return this.canonical.findIndex((record) => record.hash === blockHash);
    }

    /** Starts rebuilding `address` from its history, unless that is done or running. */
    private startBackfill(address: AccountAddress): void {
        if (
            this.backfills.has(address) ||
            this.lazyAccounts.has(address) ||
            this.stateCache.isComplete(address)
        )
            return;
        const job = this.runBackfill(address)
            .catch((error) => {
                this.logger.warn(
                    "Backfill failed; the account is read lazily",
                    {
                        address,
                        reason: this.failureReason(error)
                    }
                );
                // tell the subscribers now, so they do not wait for a snapshot
                return this.enqueue(async () => {
                    for (const peer of this.peers.values())
                        if (!peer.closing)
                            this.sendSnapshots(
                                peer,
                                [address],
                                new Set([address])
                            );
                });
            })
            .finally(() => this.backfills.delete(address));
        this.backfills.set(address, job);
    }

    /**
     * Reads the contract's history up to the best head, in rounds: the keys
     * its traces name (never their values) up to a block inside the retained
     * window, where the window's own records add the rest. Then the values of
     * all those keys are read at one block, the head, and the records after
     * it are applied. A covered block that a reorg orphaned starts over.
     */
    private async runBackfill(address: AccountAddress): Promise<void> {
        const started = Date.now();
        const upstream = {
            request: (method: string, params: unknown[]) =>
                this.request(method, params),
            requestBatch: (calls: { method: string; params: unknown[] }[]) =>
                this.upstream
                    ? this.upstream.requestBatch(calls)
                    : calls.map(() =>
                          Promise.reject(
                              new UpstreamLostError("Upstream is not open")
                          )
                      )
        };
        // the records keep its values from now on
        await this.watch(address);
        let restarts = 0;
        let covered: { number: bigint; hash: string } | undefined;
        let keys = new Set<StorageSlot>();
        let record: BackfillRecord | undefined;
        const spend = (backfill: ContractBackfill) => {
            const cost = backfill.spent;
            record ??= {
                address,
                codeProbes: 0,
                blockReads: 0,
                rootReads: 0,
                traces: 0,
                stateReads: 0,
                roundTrips: 0,
                blocks: 0,
                tracedBlocks: 0,
                slots: 0,
                milliseconds: 0
            };
            record.codeProbes += cost.codeProbes;
            record.blockReads += cost.blockReads;
            record.rootReads += cost.rootReads;
            record.traces += cost.traces;
            record.stateReads += cost.stateReads;
            record.roundTrips += cost.roundTrips;
        };
        for (let round = 0; round < BACKFILL_ROUNDS; round++) {
            if (this.stopping.signal.aborted) return;
            const tipRecord = this.canonical[this.canonical.length - 1];
            const tip = {
                number: BigInt(tipRecord.number),
                hash: tipRecord.hash
            };
            const backfill = new ContractBackfill(
                upstream,
                address,
                this.backfillBlocks
            );
            try {
                if (!covered) {
                    const deploy = await backfill.findDeployBlock(tip.number);
                    if (deploy !== undefined) {
                        const found = await backfill.keysThrough(deploy, tip);
                        for (const slot of found.keys) keys.add(slot);
                        spend(backfill);
                        record!.blocks += found.blocks;
                        record!.tracedBlocks += found.tracedBlocks;
                        record!.deployBlock = toQuantity(deploy);
                    } else spend(backfill);
                    covered = tip;
                } else if (tip.number > covered.number) {
                    const found = await backfill.keysThrough(
                        covered.number + 1n,
                        tip,
                        covered.hash
                    );
                    for (const slot of found.keys) keys.add(slot);
                    spend(backfill);
                    record!.blocks += found.blocks;
                    record!.tracedBlocks += found.tracedBlocks;
                    covered = tip;
                }
                const prepared = await this.enqueue(() =>
                    this.prepareBackfill(address, covered!, keys)
                );
                if (prepared === "again") continue;
                if (prepared === "restart")
                    throw new ChainMovedError("Covered block dropped");
                // the values at the head, read outside the queue
                const reader = new ContractBackfill(
                    upstream,
                    address,
                    this.backfillBlocks
                );
                const state = await reader.readState(
                    prepared.anchor.hash,
                    prepared.keys
                );
                spend(reader);
                // a chain that holds other entries than the history named is not backfilled whole
                // (Asset Hub's tracer can omit a constructor's repeated write: paritytech/polkadot-sdk#13663)
                const held = await this.backfillBlocks.countStorageEntries(
                    address,
                    prepared.anchor
                );
                const slots = Object.keys(state.storage).length;
                const complete = held === undefined || held === slots;
                if (!complete)
                    this.logger.warn(
                        "Backfill found fewer storage entries than the chain holds; the account stays lazy",
                        { address, backfilled: slots, onChain: held }
                    );
                const outcome = await this.enqueue(() =>
                    this.commitBackfill(
                        address,
                        prepared.anchor,
                        state,
                        complete
                    )
                );
                if (outcome === "retry") {
                    covered = prepared.anchor;
                    keys = new Set(prepared.keys);
                    continue;
                }
                record!.slots = Object.keys(state.storage).length;
                record!.milliseconds = Date.now() - started;
                this.logger.info("Backfilled an account", { ...record! });
                return;
            } catch (error) {
                // a reorg moved blocks under the read: read the range again
                if (
                    !(
                        error instanceof ChainMovedError ||
                        error instanceof UpstreamRequestError
                    ) ||
                    ++restarts > BACKFILL_RESTARTS
                )
                    throw error;
                covered = undefined;
                keys = new Set();
                record = undefined;
            }
        }
        throw new Error("The chain kept moving under the backfill");
    }

    /**
     * Once the covered block is inside the window, takes the head as the
     * anchor and adds the keys the window's blocks after the covered one
     * touched. "again" asks for one more round of traces, "restart" for a new
     * backfill after a reorg dropped the block.
     */
    private async prepareBackfill(
        address: AccountAddress,
        covered: { number: bigint; hash: string },
        keys: Set<StorageSlot>
    ): Promise<
        | "again"
        | "restart"
        | { anchor: { number: bigint; hash: string }; keys: Set<StorageSlot> }
    > {
        const index = this.retainedIndex(covered.hash);
        if (index < 0) {
            const floor = BigInt(this.canonical[0].number);
            if (covered.number >= floor) return "restart";
            // below the window: the blocks up to it are still to be read
            const current = await this.fetchHeader(covered.number);
            return current.hash === covered.hash ? "again" : "restart";
        }
        const all = new Set(keys);
        for (let i = index + 1; i < this.canonical.length; i++)
            for (const slot of this.canonical[i].touches[address]?.slots ?? [])
                all.add(slot);
        const head = this.canonical[this.canonical.length - 1];
        return {
            anchor: { number: BigInt(head.number), hash: head.hash },
            keys: all
        };
    }

    /**
     * Makes the account complete from the values read at `anchor`, if that
     * block is still on the chain: the records after it, which hold the
     * account because it is watched, bring it to the head.
     */
    private async commitBackfill(
        address: AccountAddress,
        anchor: { number: bigint; hash: string },
        state: BackfilledState,
        complete: boolean
    ): Promise<"done" | "retry"> {
        const index = this.retainedIndex(anchor.hash);
        if (index < 0) return "retry";
        const scratch = new StateCache();
        scratch.setComplete(
            address,
            {
                balance: normalizeBalance(state.balance),
                nonce: Number(BigInt(state.nonce)),
                code: state.code
            },
            state.storage
        );
        for (let i = index + 1; i < this.canonical.length; i++) {
            scratch.applyForward(this.canonical[i]);
        }
        const account = scratch.accountOf(address);
        if (complete)
            this.stateCache.setComplete(
                address,
                {
                    balance: account.balance!,
                    nonce: account.nonce!,
                    code: account.code!
                },
                account.storage ?? {}
            );
        else {
            this.lazyAccounts.add(address);
            // what is known is cached; any other slot is fetched when asked for
            for (const kind of ["balance", "nonce", "code"] as const)
                this.stateCache.set({ kind, address }, account[kind]!);
            for (const [slot, word] of Object.entries(account.storage ?? {}))
                this.stateCache.set({ kind: "slot", address, slot }, word);
        }
        for (const peer of this.peers.values()) {
            if (!peer.closing) this.sendSnapshots(peer, [address]);
        }
        this.persisted?.scheduleSave();
        return "done";
    }

    /**
     * Sends `peer` the complete state of those of `addresses` it subscribed
     * to and has no snapshot of yet, at the best head, one message per
     * subscription.
     */
    private sendSnapshots(
        peer: StorageDiffPeer,
        addresses: AccountAddress[],
        lazy: ReadonlySet<AccountAddress> = this.lazyAccounts
    ): void {
        const head = this.canonical[this.canonical.length - 1];
        // a ready account the cache no longer holds complete is late
        this.noteSnapshotsDelayed(
            peer,
            addresses.filter(
                (address) =>
                    peer.promisedReady.has(address) &&
                    !lazy.has(address) &&
                    !this.stateCache.isComplete(address)
            )
        );
        for (const [subscription, subscribed] of peer.subscriptions) {
            const accounts: AccountDiffs = {};
            // accounts no snapshot is coming for: the peer reads them as needed
            const noSnapshot: AccountAddress[] = [];
            for (const address of addresses) {
                if (!subscribed.includes(address)) continue;
                if (lazy.has(address)) noSnapshot.push(address);
                if (
                    peer.snapshotted.has(address) ||
                    !this.stateCache.isComplete(address)
                )
                    continue;
                accounts[address] = this.stateCache.accountOf(address);
                peer.snapshotted.add(address);
                peer.promisedReady.delete(address);
            }
            if (Object.keys(accounts).length === 0 && noSnapshot.length === 0)
                continue;
            this.send(peer.socket, {
                jsonrpc: "2.0",
                method: "scp_snapshot",
                params: {
                    subscription,
                    result: {
                        block: { number: head.number, hash: head.hash },
                        accounts,
                        ...(noSnapshot.length > 0 && { lazy: noSnapshot })
                    }
                }
            });
            this.dropIfLagging(peer);
        }
    }

    /**
     * Tells `peer` that the snapshots it was promised or sent as `ready` for
     * those of `addresses` it follows are late, one notice per subscription.
     * An account is told once: it is no longer promised.
     */
    private noteSnapshotsDelayed(
        peer: StorageDiffPeer,
        addresses: AccountAddress[]
    ): void {
        if (peer.closing || addresses.length === 0) return;
        const head = this.canonical[this.canonical.length - 1];
        for (const [subscription, subscribed] of peer.subscriptions) {
            const accounts = [...new Set(addresses)].filter((address) =>
                subscribed.includes(address)
            );
            if (accounts.length === 0) continue;
            this.pushDelay(peer, {
                reason: "snapshot-delayed",
                subscription,
                block: { number: head.number, hash: head.hash },
                accounts
            });
        }
        for (const address of addresses) peer.promisedReady.delete(address);
    }

    private fieldsOf(request: StateRequest): StateField[] {
        const { address } = request;
        return [
            ...request.slots.map(
                (slot): StateField => ({
                    kind: "slot",
                    address,
                    slot
                })
            ),
            ...(request.account
                ? [
                      { kind: "balance", address } as const,
                      { kind: "nonce", address } as const
                  ]
                : []),
            ...(request.code ? [{ kind: "code", address } as const] : [])
        ];
    }

    private accountsOf(
        requests: StateRequest[],
        fields: StateField[],
        values: StateCache
    ): AccountDiffs {
        const accounts: AccountDiffs = {};
        for (const request of requests) accounts[request.address] ??= {};
        for (const field of fields) {
            const account = accounts[field.address];
            const value = values.get(field)!;
            if (field.kind === "slot") {
                (account.storage ??= {})[field.slot] = value as string;
            } else if (field.kind === "nonce") {
                account.nonce = value as number;
            } else {
                account[field.kind] = value as string;
            }
        }
        return accounts;
    }

    /**
     * Starts one batched upstream request for every field that is neither
     * cached nor being fetched, so a read of many fields is one round trip.
     * Each field gets its own flight, which settles from the batch answer.
     */
    private fetchMissing(fields: StateField[]): void {
        const pinned = this.canonical[this.canonical.length - 1].hash;
        const missing = new Map<FlightKey, StateField>();
        for (const field of fields) {
            const key: FlightKey = JSON.stringify(field);
            if (
                this.stateCache.get(field) === undefined &&
                !this.flights.has(key)
            )
                missing.set(key, field);
        }
        if (missing.size === 0) return;
        const entries = [...missing];
        const answers = this.upstream
            ? this.upstream.requestBatch(
                  entries.map(([, field]) => this.fieldCall(field, pinned))
              )
            : entries.map(() =>
                  Promise.reject(new UpstreamLostError("Upstream is not open"))
              );
        entries.forEach(([key, field], i) => {
            const first = answers[i].then((raw) => this.parseField(field, raw));
            const flight = this.loadField(field, {
                pinned,
                value: first
            }).finally(() => this.flights.delete(key));
            this.flights.set(key, flight);
        });
    }

    /** Waits until `field` is cached, fetching it unless a fetch is running. */
    private async ensureCached(field: StateField): Promise<void> {
        if (this.stateCache.get(field) !== undefined) return;
        const key: FlightKey = JSON.stringify(field);
        let flight = this.flights.get(key);
        if (!flight) {
            flight = this.loadField(field).finally(() =>
                this.flights.delete(key)
            );
            this.flights.set(key, flight);
        }
        await flight;
    }

    /**
     * Reads `field` at the best head's hash, so the value belongs to the
     * chain the service follows. If the chain moved on meanwhile, later
     * blocks' writes are applied to it; if that block was dropped, it reads
     * again.
     */
    private async loadField(
        field: StateField,
        first?: { pinned: string; value: Promise<StateValue> }
    ): Promise<void> {
        let unused = first;
        for (let attempt = 0; attempt <= RECONCILE_RETRY_LIMIT; attempt++) {
            const pinned =
                unused?.pinned ??
                this.canonical[this.canonical.length - 1].hash;
            // the first try is the batch's answer; a retry asks on its own
            const issued = unused;
            unused = undefined;
            const value = await this.retryTransient(
                () =>
                    issued
                        ? issued.value.catch((error) => {
                              issued.value = this.fetchField(field, pinned);
                              throw error;
                          })
                        : this.fetchField(field, pinned),
                "Retrying the state fetch"
            );
            const index = this.retainedIndex(pinned);
            if (index < 0) continue;
            const scratch = new StateCache();
            scratch.set(field, value);
            for (let i = index + 1; i < this.canonical.length; i++) {
                scratch.applyForward(this.canonical[i]);
            }
            this.stateCache.set(field, scratch.get(field)!);
            return;
        }
        throw new HeadChangedError("The chain moved while state was fetched");
    }

    private async fetchField(
        field: StateField,
        blockHash: string
    ): Promise<StateValue> {
        const { method, params } = this.fieldCall(field, blockHash);
        return this.parseField(field, await this.request(method, params));
    }

    /** The upstream read of `field` at exactly block `blockHash` (EIP-1898). */
    private fieldCall(
        field: StateField,
        blockHash: string
    ): { method: string; params: unknown[] } {
        const at = { blockHash };
        const { address } = field;
        if (field.kind === "slot") {
            return {
                method: "eth_getStorageAt",
                params: [address, field.slot, at]
            };
        }
        const method = {
            balance: "eth_getBalance",
            nonce: "eth_getTransactionCount",
            code: "eth_getCode"
        }[field.kind];
        return { method, params: [address, at] };
    }

    private parseField(field: StateField, answer: unknown): StateValue {
        if (field.kind === "slot") {
            const word = answer;
            if (
                typeof word !== "string" ||
                !/^0x[0-9a-fA-F]{1,64}$/.test(word)
            ) {
                throw new Error("Malformed storage word from upstream");
            }
            return "0x" + word.slice(2).toLowerCase().padStart(64, "0");
        }
        const value = answer;
        if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
            throw new Error(`Malformed ${field.kind} from upstream`);
        }
        if (field.kind === "code") return value.toLowerCase();
        if (value === "0x")
            throw new Error(`Malformed ${field.kind} from upstream`);
        return field.kind === "balance"
            ? normalizeBalance(value)
            : Number(BigInt(value));
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
                    reason: this.failureReason(error)
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
        const woke = Date.now();
        this.enqueue(async () => {
            this.wakeQueued = false;
            await this.retryTransient(
                () => this.reconcileHead(),
                "Retrying head reconciliation"
            );
            this.headWaiters.recordArrival(Date.now() - woke);
        }).catch((error) => {
            // A lost upstream is reconnected; the reconnect wakes again.
            if (error instanceof UpstreamLostError) return;
            this.fail(error);
        });
    }

    // The upstream URL can carry credentials: nothing may echo it.
    private failureReason(error: unknown): string {
        return describeError(error)
            .split(this.upstreamUrl)
            .join(this.upstreamEndpoint);
    }

    private fail(error: unknown): void {
        if (this.stopping.signal.aborted) return;
        const failure = new Error(this.failureReason(error));
        this.logger.error("Storage diff service failed", {
            reason: failure.message
        });
        void this.teardown(failure);
    }

    private teardown(reason?: Error): Promise<void> {
        this.shutdown ??= (async () => {
            this.stopping.abort();
            this.headWaiters.endAll();
            await this.persisted?.flush();
            this.includedStrategy?.close();
            this.backfillBlocks.close();
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
