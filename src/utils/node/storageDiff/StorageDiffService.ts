import type ABackfillBlockSource from "./backfillBlocks/ABackfillBlockSource";
import { ListedBlockSource } from "./backfillBlocks/ListedBlockSource";
import { BackfillCoordinator } from "./BackfillCoordinator";
import {
    bloomContains,
    environmentOf,
    filterRecord,
    hasRevertedFrame,
    mergeTransactionDiffs,
    touchesOf,
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
    type SnapshotStatus,
    type SubscribeResult,
    type SubscriptionId
} from "./blockStorageDiff";
import { HeadWaiters } from "./HeadWaiters";
import type AIncludedHeadStrategy from "./includedHead/AIncludedHeadStrategy";
import type { IncludedHead } from "./includedHead/AIncludedHeadStrategy";
import { PeerHub, type StorageDiffPeer } from "./PeerHub";
import { PersistedCache } from "./PersistedCache";
import {
    HeadChangedError,
    isTransient,
    RECONCILE_RETRY_BACKOFF_MS,
    RECONCILE_RETRY_LIMIT,
    UPSTREAM_RECONNECT_BACKOFF_MS,
    UPSTREAM_RECONNECT_LIMIT
} from "./retryPolicy";
import {
    fieldKey,
    StateCache,
    type FieldKey,
    type StateField,
    type StateValue
} from "./StateCache";
import { StateReader } from "./StateReader";
import { StateStore } from "./StateStore";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import {
    UpstreamLostError,
    UpstreamRequestError,
    UpstreamRpcClient
} from "./UpstreamRpcClient";
import type {
    StorageDiffCatchUp,
    StorageDiffDelayNotice,
    StorageDiffState
} from "../../storageDiff/storageDiffWire";
import type { Logger } from "@/utils";
import { retry } from "@/utils/retry";
import { toQuantity } from "ethers";

const DEFAULT_RETENTION_BLOCKS = 128;
export type { StorageDiffCatchUp, StorageDiffState };

const DEFAULT_MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
const DEFAULT_PORT = 19778;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

const CALL_TRACE_OPTIONS = { tracer: "callTracer" };

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
    private readonly retention: number;
    private readonly includedStrategy?: AIncludedHeadStrategy;
    private readonly backfillBlocks: ABackfillBlockSource;
    private readonly stopping = new AbortController();
    private upstream?: UpstreamRpcClient;
    private canonical: StagedBlock[] = [];
    // Account and slot values at the best head; every upstream read fills it.
    private readonly stateCache = new StateCache();
    private included?: IncludedHead;
    // Hash of the included head already reported as off the best chain.
    private divergenceReported?: string;
    // Accounts the service keeps the values of in every record it stages: one
    // entry per account, settled when the retained records hold them too.
    private readonly watched = new Map<AccountAddress, Promise<void>>();
    // Accounts whose backfill found fewer entries than the chain holds: read lazily, not backfilled again.
    private readonly lazyAccounts = new Set<AccountAddress>();
    private readonly persisted?: PersistedCache;
    private readonly peerHub: PeerHub;
    private readonly backfill: BackfillCoordinator;
    private readonly headWaiters: HeadWaiters;
    private readonly stateReader: StateReader;
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
        this.retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        this.peerHub = new PeerHub({
            host: options.host ?? "127.0.0.1",
            port: options.port ?? DEFAULT_PORT,
            maxPeerBufferedBytes:
                options.maxPeerBufferedBytes ?? DEFAULT_MAX_PEER_BUFFERED_BYTES,
            createMethods: (peer) => new StorageDiffRpcMethods(this, peer),
            fail: (error) => this.fail(error)
        });
        this.stateReader = new StateReader({
            canonical: () => this.canonical,
            stateCache: this.stateCache,
            upstream: () => this.upstream,
            request: (method, params) => this.request(method, params),
            retryTransient: (job, message) => this.retryTransient(job, message),
            retainedIndex: (blockHash) => this.retainedIndex(blockHash),
            watch: (address) => this.watch(address)
        });
        this.backfill = new BackfillCoordinator({
            stopping: this.stopping.signal,
            canonical: () => this.canonical,
            stateCache: this.stateCache,
            lazyAccounts: this.lazyAccounts,
            backfillBlocks: this.backfillBlocks,
            upstream: () => this.upstream,
            request: (method, params) => this.request(method, params),
            watch: (address) => this.watch(address),
            logger: this.logger,
            failureReason: (error) => this.failureReason(error),
            enqueue: (job) => this.enqueue(job),
            peerHub: this.peerHub,
            retainedIndex: (blockHash) => this.retainedIndex(blockHash),
            fetchHeader: (by) => this.fetchHeader(by),
            scheduleSave: () => this.persisted?.scheduleSave()
        });
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
        return this.peerHub.url;
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
            if (!this.peerHub.peers.has(peer.socket))
                throw new Error("Peer closed");
            const id = "0x" + (++peer.nextSubscription).toString(16);
            peer.subscriptions.set(id, addresses);
            // after the reply: the peer learns the id before the snapshots
            peer.afterReply.set(id, () => {
                void this.enqueue(async () => {
                    this.backfill.sendSnapshots(peer, addresses);
                    for (const address of addresses)
                        this.backfill.start(address);
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
        return await this.stateReader.getState(blockHash, requests);
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
        for (const peer of this.peerHub.peers.values()) {
            if (peer.closing || peer.subscriptions.size === 0) continue;
            this.peerHub.pushDelay(peer, notice);
        }
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
            for (const peer of this.peerHub.peers.values()) {
                if (peer.closing || peer.subscriptions.size === 0) continue;
                this.peerHub.send(peer.socket, {
                    jsonrpc: "2.0",
                    method: "scp_includedHead",
                    params: record
                });
                this.peerHub.dropIfLagging(peer);
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
            await this.peerHub.listen();
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
            await this.attachLogs(record, this.peerHub.subscribedAddresses());
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
        const calls = fields.map((field) =>
            this.stateReader.fieldCall(field, record.hash)
        );
        fields.forEach((field, i) => {
            if (before[i] === undefined)
                calls.push(
                    this.stateReader.fieldCall(field, record.parentHash)
                );
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
            const post = this.stateReader.parseField(field, answers[i]);
            running.set(fieldKey(field), post);
            const pre =
                before[i] ??
                this.stateReader.parseField(field, answers[next++ as number]);
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
            for (const peer of this.peerHub.peers.values()) {
                this.backfill.noteSnapshotsDelayed(peer, [
                    ...peer.snapshotted,
                    ...peer.promisedReady
                ]);
                peer.snapshotted.clear();
            }
            for (const address of this.peerHub.subscribedAddresses())
                this.backfill.start(address);
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
        for (const record of staged.slice(below ? 1 : 0))
            this.peerHub.publish(record);
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
                        for (const peer of this.peerHub.peers.values()) {
                            peer.snapshotted.delete(address);
                            if (!peer.closing)
                                this.backfill.sendSnapshots(peer, [address]);
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

    private retainedIndex(blockHash: string): number {
        return this.canonical.findIndex((record) => record.hash === blockHash);
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
            await this.peerHub.close();
            if (reason) this.settleClosed.reject(reason);
            else this.settleClosed.resolve();
        })();
        return this.shutdown;
    }
}
