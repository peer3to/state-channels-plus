import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream
} from "./backfillBlocks/ABackfillBlockSource";
import { ListedBlockSource } from "./backfillBlocks/ListedBlockSource";
import {
    bloomContains,
    environmentOf,
    filterRecord,
    invalidParams,
    isObject,
    LIMIT_EXCEEDED_ERROR_CODE,
    NOT_RETAINED_ERROR_CODE,
    parseHeader,
    parseLogs,
    PRUNED_ERROR_CODE,
    rpcError,
    type AccountAddress,
    type AccountDiffs,
    type BlockEnvironment,
    type BlockHeader,
    type RpcBlock,
    type SnapshotStatus,
    type StagedBlock,
    type StorageSlot,
    type SubscribeResult,
    type SubscriptionId
} from "./blockStorageDiff";
import { PeerHub, type StorageDiffPeer } from "./PeerHub";
import { type ParsedBlockSelector, type StateRequest } from "./rpcParams";
import {
    fieldKey,
    normalizeBalance,
    StateCache,
    type FieldKey,
    type StateField,
    type StateValue
} from "./StateCache";
import { StorageDiffRpcMethods } from "./StorageDiffRpcMethods";
import {
    hasRevertedFrame,
    mergeTransactionDiffs,
    touchesOf,
    type BlockTouches
} from "./traceDiffs";
import {
    LearnedBackstop,
    SDK_RPC_DEADLINE_MS
} from "../../storageDiff/LearnedBackstop";
import type {
    StorageDiffCatchUp,
    StorageDiffDelayNotice,
    StorageDiffState
} from "../../storageDiff/storageDiffWire";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import type { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { retry } from "@/utils/retry";
import { toQuantity } from "ethers";

const DEFAULT_RETENTION_BLOCKS = 128;
export type { StorageDiffCatchUp, StorageDiffState };

const DEFAULT_MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ADDRESSES_PER_REQUEST = 1000;
const DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION = 64;
const DEFAULT_MAX_CONNECTIONS = 256;
const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 32;
const DEFAULT_MAX_WATCHED_ADDRESSES = 10_000;
const DEFAULT_MAX_WATCHED_ADDRESSES_PER_CONNECTION = 2000;
const DEFAULT_PORT = 19778;
/** How long one upstream request may take, a reconnect included. */
const DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;
/** Retries of a failed head reconciliation before the service fails. */
const RECONCILE_RETRY_LIMIT = 3;
/** Delay before the first retry; each further retry doubles it. */
const RECONCILE_RETRY_BACKOFF_MS = 250;
/** State reads for peers at the upstream at once; the head's own reads keep room. */
const MAX_STATE_FETCHES_IN_FLIGHT = 16;

const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

const CALL_TRACE_OPTIONS = { tracer: "callTracer" };

/** Rounds a backfill may take to catch up with a head that keeps moving. */
const BACKFILL_ROUNDS = 100;
/** Times a backfill starts over after a reorg moved blocks under it. */
const BACKFILL_RESTARTS = 5;
/** Blocks one backfill traces at once. */
const BACKFILL_TRACES_AT_ONCE = 8;
/** Backfills that read at once; the others wait, `syncing`. */
const BACKFILLS_AT_ONCE = 2;
/** JSON-RPC code of an upstream that does not know a method. */
const METHOD_NOT_FOUND_CODE = -32601;
/**
 * What Asset Hub's eth-rpc answers a read below the block its contracts
 * pallet arrived at: there is no code there.
 */
const NOT_SUPPORTED_AT_BLOCK = "is not supported at the queried block";

/** Identifies one state fetch in flight: a `StateField` as text. */
type FlightKey = string;

/** An account whose values the records keep, and who needs them now. */
type WatchedAccount = {
    /** Settles when the retained records hold the account. */
    filled: Promise<void>;
    /** The last fill failed: the next hold fills again. */
    failed: boolean;
    /** Subscriptions naming it and requests reading it now; it is never dropped while any are. */
    holders: number;
};

/** A read held until the best head reaches `minBlock`; `end` lets it go. */
interface HeadWaiter {
    minBlock: bigint;
    end: () => void;
}

/** What one contract's backfill cost and found. */
export interface BackfillRecord {
    address: AccountAddress;
    /** Block the contract's code first appears at; undefined for an account without code. */
    deployBlock?: string;
    /** `eth_getCode` calls of the search for the deploy block. */
    codeProbes: number;
    /** `eth_getBlockByNumber` calls that listed the blocks. */
    blockReads: number;
    /** Child trie root reads that found the changed blocks. */
    rootReads: number;
    /** `debug_traceBlockByNumber` calls. */
    traces: number;
    /** Reads of the final balance, nonce, code and slot values. */
    stateReads: number;
    /** Blocks listed, and how many of them were traced. */
    blocks: number;
    tracedBlocks: number;
    /** Slots found written. */
    slots: number;
    milliseconds: number;
}

/** A contract's state as the node reports it at one block. */
interface BackfilledState {
    balance: string;
    nonce: number;
    code: string;
    /** The slots read, zero words left out. */
    storage: Record<StorageSlot, string>;
}

/** The entry recount of one complete account: one at a time, the newest next. */
interface Recount {
    /** The newest block written since the running count started. */
    next?: { block: StagedBlock; cached: number };
}

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
    /** How long one upstream request may take, a reconnect included; 10 s by default. */
    upstreamRequestTimeoutMs?: number;
    /** Addresses one subscription or catch-up, and accounts one state read, may name; 1,000 by default. */
    maxAddressesPerRequest?: number;
    /** Subscriptions one connection may hold open; 64 by default. */
    maxSubscriptionsPerConnection?: number;
    /** Connections open at once; 256 by default. */
    maxConnections?: number;
    /** Requests of one connection being answered at once; 32 by default. */
    maxInFlightRequests?: number;
    /** Accounts whose values the service keeps; 10,000 by default. */
    maxWatchedAddresses?: number;
    /** Accounts one connection's subscriptions and requests may hold at once; 2,000 by default. */
    maxWatchedAddressesPerConnection?: number;
    /** Browser origins that may connect; a connection without an `Origin` header always may. */
    allowedOrigins?: string[];
    /**
     * Where a backfill learns which blocks to trace. Defaults to listing every
     * block of the range, which suits dev chains.
     */
    backfillBlocks?: ABackfillBlockSource;
    logger: Logger;
}

/**
 * The upstream answered a request with an error; `upstreamCode` is its
 * JSON-RPC code. Not named `code`: a peer is answered with the code and
 * message of an error that has one, and the upstream's are not for peers.
 */
class UpstreamRequestError extends Error {
    readonly upstreamCode?: number;

    constructor(message: string, upstreamCode?: number) {
        super(message);
        this.upstreamCode = upstreamCode;
    }
}

/** The upstream did not answer a request in time. */
class UpstreamTimeoutError extends Error {}

/** The upstream chain moved while a reconciliation read it. */
class HeadChangedError extends Error {}

/** Whether a failure is worth another try: the chain moved, or the upstream answered with an error or too late. */
function isTransient(error: unknown): boolean {
    return (
        error instanceof HeadChangedError ||
        error instanceof UpstreamRequestError ||
        error instanceof UpstreamTimeoutError
    );
}

/**
 * The JSON-RPC code of an upstream's error answer: ethers keeps the answer as
 * `error`, or as `info.error` for a method it reads as unsupported.
 */
function rpcErrorCode(error: unknown): number | undefined {
    const shaped = error as {
        error?: { code?: unknown };
        info?: { error?: { code?: unknown } };
    };
    const code = shaped?.error?.code ?? shaped?.info?.error?.code;
    return typeof code === "number" ? code : undefined;
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
 * one trusted upstream (`eth_subscribe` `newHeads`), traces every new block
 * once with one `prestateTracer` (diff mode) and one `callTracer` trace,
 * keeps the last `retention` canonical records, and serves address-filtered
 * JSON-RPC 2.0 over WebSocket: `scp_subscribeContractStorage` pushes future
 * records, `scp_getContractStorageDiffs` replays retained ones,
 * `scp_getState` reads account and storage values at a retained block and
 * `scp_unsubscribe` ends a subscription. Records follow the best head and
 * roll back with it on a reorg, and carry the logs of the subscribed
 * addresses their header bloom matches. The first subscription to an account
 * backfills its complete state from its history and pushes it as
 * `scp_snapshot`; `scp_getBlock`, `scp_getTransaction` and
 * `scp_getTransactionReceipt` answer from the retained blocks, and a read
 * that names a block the head lacks waits for it until a learned backstop.
 * The upstream is one `RpcNodeProvider`: a lost socket is reconnected and its
 * requests sent again, and each new socket reconciles from the last canonical
 * record. A reorg or an upstream error answer or timeout during startup or
 * reconciliation is retried. A failure that outlasts its retries is fatal: a
 * supervisor restarts the process and consumers catch up.
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
    private readonly upstreamRequestTimeoutMs: number;
    private readonly maxAddressesPerRequest: number;
    private readonly maxSubscriptionsPerConnection: number;
    private readonly maxWatchedAddresses: number;
    private readonly maxWatchedAddressesPerConnection: number;
    private readonly stopping = new AbortController();
    private readonly upstream: RpcNodeProvider;
    private canonical: StagedBlock[] = [];
    // Account and slot values at the best head; every upstream read fills it.
    private readonly stateCache = new StateCache();
    // Accounts the service keeps the values of in every record it stages,
    // least recently used first. Only a watched account's values are cached.
    private readonly watched = new Map<AccountAddress, WatchedAccount>();
    // One fetch per missing field, shared by every reader waiting for it.
    private readonly flights = new Map<FlightKey, Promise<void>>();
    // State reads at the upstream now, and the ones waiting for a free place:
    // peers' reads, then a backfill's, which get a place only when no peer's waits.
    private stateFetchesInFlight = 0;
    private readonly stateFetchWaiters: (() => void)[] = [];
    private readonly backfillFetchWaiters: (() => void)[] = [];
    // Accounts whose backfill failed or found fewer entries than the chain holds: read lazily, not backfilled again.
    private readonly lazyAccounts = new Set<AccountAddress>();
    // Backfills in flight, one per account.
    private readonly backfills = new Map<AccountAddress, Promise<void>>();
    // Backfills reading now, and the ones waiting for a free place.
    private backfillsRunning = 0;
    private readonly backfillWaiters: (() => void)[] = [];
    // Entry recounts in flight, one per account.
    private readonly recounts = new Map<AccountAddress, Recount>();
    private readonly backfillBlocks: ABackfillBlockSource;
    // What backfill reads go through: the state fetch limit and the request timeout.
    private readonly backfillUpstream: BackfillUpstream;
    // Whether the upstream answers eth_getBlockReceipts; a method-not-found answer turns it off.
    private blockReceiptsSupported = true;
    // Reads waiting for the best head to reach the block their caller saw.
    private readonly headWaiters = new Set<HeadWaiter>();
    // The ask for the upstream's newest block number, one for all those reads.
    private upstreamHeadProbe?: Promise<void>;
    // Set when a read started waiting after that ask was sent: it asks once more.
    private upstreamHeadProbeAgain = false;
    // The last `upstream-behind` pushed, as "requested@head hash": the same one
    // at the same head is not pushed again.
    private lastUpstreamBehind?: string;
    // How long such a read may wait when no event ends it: learned from how
    // long a new head took to commit after the upstream announced it.
    private readonly backstop = new LearnedBackstop(SDK_RPC_DEADLINE_MS);
    private readonly peerHub: PeerHub;
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
        this.retention = options.retention ?? DEFAULT_RETENTION_BLOCKS;
        this.upstreamRequestTimeoutMs =
            options.upstreamRequestTimeoutMs ??
            DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS;
        this.maxAddressesPerRequest =
            options.maxAddressesPerRequest ?? DEFAULT_MAX_ADDRESSES_PER_REQUEST;
        this.maxSubscriptionsPerConnection =
            options.maxSubscriptionsPerConnection ??
            DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION;
        this.maxWatchedAddresses =
            options.maxWatchedAddresses ?? DEFAULT_MAX_WATCHED_ADDRESSES;
        this.maxWatchedAddressesPerConnection =
            options.maxWatchedAddressesPerConnection ??
            DEFAULT_MAX_WATCHED_ADDRESSES_PER_CONNECTION;
        this.upstream = new RpcNodeProvider(options.upstreamUrl, this.logger);
        this.backfillBlocks = options.backfillBlocks ?? new ListedBlockSource();
        // a failed read is asked again on its own, not the whole backfill
        this.backfillUpstream = {
            request: (method, params) =>
                this.retryTransient(
                    () =>
                        this.limitBackfillFetch(() =>
                            this.request(method, params)
                        ),
                    "Retrying a backfill read"
                ),
            requestOn: (node, method, params) =>
                this.retryTransient(
                    () =>
                        this.limitBackfillFetch(() =>
                            this.request(method, params, node)
                        ),
                    "Retrying a backfill read"
                ),
            logger: this.logger
        };
        this.peerHub = new PeerHub({
            host: options.host ?? "127.0.0.1",
            port: options.port ?? DEFAULT_PORT,
            maxPeerBufferedBytes:
                options.maxPeerBufferedBytes ?? DEFAULT_MAX_PEER_BUFFERED_BYTES,
            maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
            maxInFlightRequests:
                options.maxInFlightRequests ?? DEFAULT_MAX_IN_FLIGHT_REQUESTS,
            allowedOrigins: options.allowedOrigins ?? [],
            createMethods: (peer) => new StorageDiffRpcMethods(this, peer),
            disconnected: (peer) => this.disconnected(peer),
            fail: (error) => this.fail(error)
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
        try {
            const parsed = new URL(options.upstreamUrl);
            if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
                throw new Error("unsupported protocol");
            }
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
        const limits = {
            maxPeerBufferedBytes: options.maxPeerBufferedBytes,
            maxAddressesPerRequest: options.maxAddressesPerRequest,
            maxSubscriptionsPerConnection:
                options.maxSubscriptionsPerConnection,
            maxConnections: options.maxConnections,
            maxInFlightRequests: options.maxInFlightRequests,
            maxWatchedAddresses: options.maxWatchedAddresses,
            maxWatchedAddressesPerConnection:
                options.maxWatchedAddressesPerConnection
        };
        for (const [name, limit] of Object.entries(limits)) {
            if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
                throw new Error(`${name} must be a positive integer`);
        }
        const service = new StorageDiffService(
            options,
            LoggerUtils.getRpcNodeMetadata(options.upstreamUrl).rpcNode
        );
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
        this.assertAddressCount(addresses);
        return await this.enqueue(async () => {
            if (!this.peerHub.peers.has(peer.socket))
                throw new Error("Peer closed");
            if (peer.subscriptions.size >= this.maxSubscriptionsPerConnection)
                throw rpcError(
                    LIMIT_EXCEEDED_ERROR_CODE,
                    `A connection may hold at most ${this.maxSubscriptionsPerConnection} subscriptions`
                );
            // the records keep these accounts' values from the next block on
            this.hold(peer, addresses).catch(() => undefined);
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

    /**
     * Takes effect at once: no record is pushed to `id` after this. An
     * account no other subscription of the peer follows gets its snapshot
     * again when it is subscribed again: the peer missed its records.
     */
    unsubscribe(peer: StorageDiffPeer, id: SubscriptionId): boolean {
        const addresses = peer.subscriptions.get(id);
        if (!addresses) return false;
        peer.subscriptions.delete(id);
        this.release(peer, addresses);
        peer.afterReply.delete(id);
        const followed = new Set([...peer.subscriptions.values()].flat());
        for (const address of [...peer.snapshotted, ...peer.promisedReady])
            if (!followed.has(address)) {
                peer.snapshotted.delete(address);
                peer.promisedReady.delete(address);
            }
        return true;
    }

    async getDiffs(
        peer: StorageDiffPeer,
        addresses: AccountAddress[],
        fromBlock: bigint
    ): Promise<StorageDiffCatchUp> {
        this.assertAddressCount(addresses);
        // the records hold the requested accounts, filled in if need be
        const filled = this.hold(peer, addresses);
        try {
            await filled;
            return await this.readDiffs(addresses, fromBlock);
        } finally {
            this.release(peer, addresses);
        }
    }

    /**
     * The values of the requested fields at retained block `blockHash`.
     * A field missing from the cache is fetched from the upstream once, at the
     * best head, however many readers wait for it; an older block is answered
     * by undoing the later blocks' writes with their `pre` values.
     */
    async getState(
        peer: StorageDiffPeer,
        blockHash: string,
        requests: StateRequest[]
    ): Promise<StorageDiffState> {
        const addresses = requests.map((request) => request.address);
        this.assertAddressCount(addresses);
        // the records hold the requested accounts, which a value read needs
        const filled = this.hold(peer, addresses);
        try {
            await filled;
            return await this.readState(blockHash, requests);
        } finally {
            this.release(peer, addresses);
        }
    }

    private async readDiffs(
        addresses: AccountAddress[],
        fromBlock: bigint
    ): Promise<StorageDiffCatchUp> {
        // Logs of blocks staged before anyone subscribed to these addresses,
        // fetched outside the queue so a catch-up never holds back the head.
        const selected = this.canonical.filter(
            (record) => BigInt(record.number) >= fromBlock
        );
        await this.retryTransient(
            () =>
                Promise.all(
                    selected.map((block) =>
                        this.limitStateFetch(() =>
                            this.attachLogs(block, addresses)
                        )
                    )
                ),
            "Retrying the log fetch"
        );
        return await this.enqueue(async () => {
            const best = this.canonical[this.canonical.length - 1];
            const head = BigInt(best.number);
            const environment = environmentOf(best);
            if (fromBlock > head) {
                return { records: [], head: environment };
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
            // a block staged since the fetch above holds only the logs of
            // the addresses subscribed at its staging
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
                head: environment
            };
        });
    }

    private async readState(
        blockHash: string,
        requests: StateRequest[]
    ): Promise<StorageDiffState> {
        const fields = requests.flatMap((request) => this.fieldsOf(request));
        return await this.retryWhileChainMoves(async () => {
            this.assertRetained(blockHash);
            this.fetchMissing(fields);
            await Promise.all(fields.map((field) => this.ensureCached(field)));
            // Synchronous from here: the cache and the chain agree.
            const index = this.retainedIndex(blockHash);
            const heads = fields.map((field) => this.stateCache.get(field));
            if (index < 0 || heads.some((value) => value === undefined))
                throw new HeadChangedError(
                    "The chain moved while state was read"
                );
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
        });
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
        await this.reachHead(minBlock);
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
        await this.reachHead(minBlock);
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
        await this.reachHead(minBlock);
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
                    isObject(receipt) &&
                    receipt.transactionHash === transaction.hash
            ) ?? null
        );
    }

    /** The environment of the best head, once it reaches `minBlock` if one is named. */
    async getHead(minBlock?: bigint): Promise<BlockEnvironment> {
        await this.reachHead(minBlock);
        return environmentOf(this.canonical[this.canonical.length - 1]);
    }

    private async open(): Promise<void> {
        try {
            const failure = await this.upstream.firstAttempt;
            if (failure) throw failure;
            // every socket carries the head subscription; a new one may have
            // missed heads, so it reconciles from the last record
            this.upstream.watchSockets((socket, reopened) => {
                void socket.on("block", () => this.wake());
                if (reopened) this.wake();
            });
            // a lost socket reconciles too: an outage that outlasts the
            // request retries fails the service instead of leaving it stale
            this.upstream.watchConnectionLoss(() => this.wake());
            this.canonical = await this.retryTransient(
                () => this.loadHistory(),
                "Retrying the initial history load"
            );
            await this.peerHub.listen();
        } catch (error) {
            const failure = new Error(this.failureReason(error));
            await this.teardown(failure).catch(() => undefined);
            throw failure;
        }
        this.ready = true;
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

    private enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = this.queueTail.then(job);
        this.queueTail = run.catch(() => undefined);
        return run;
    }

    /**
     * One upstream request, or one to `node`. An error answer becomes
     * `UpstreamRequestError`, and an answer that takes longer than the request timeout (a reconnect
     * included) `UpstreamTimeoutError`: both are retried.
     */
    private async request(
        method: string,
        params: unknown[],
        node: RpcNodeProvider = this.upstream
    ): Promise<unknown> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new UpstreamTimeoutError(`Upstream ${method} timed out`)
                    ),
                this.upstreamRequestTimeoutMs
            );
        });
        try {
            return await Promise.race([
                node.send(method, params).catch((error: unknown) => {
                    if (this.stopping.signal.aborted) throw error;
                    throw new UpstreamRequestError(
                        describeError(error),
                        rpcErrorCode(error)
                    );
                }),
                expired
            ]);
        } finally {
            clearTimeout(timer);
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
        let blocks = below ? [below, ...branch] : branch;
        // After a long outage or a deep reorg only the newest blocks stay
        // retained, so only they are traced; the history restarts at them.
        const restarts = blocks.length > this.retention;
        if (restarts) blocks = blocks.slice(-this.retention);
        // A traced block was checked after its trace; an empty tip is not
        // rechecked: a reorg during staging wakes a new reconciliation.
        const staged = await this.stage(
            blocks,
            // the cache is at the first block's parent when the branch extends the head
            !restarts && !below && ancestor === canonical.length - 1
                ? "cache"
                : "chain"
        );
        // Cached values follow the chain: back over the orphans, then forward.
        if (below || restarts) {
            this.stateCache.clear();
            this.lazyAccounts.clear();
            // nothing is complete now: peers get new snapshots after new backfills
            for (const peer of this.peerHub.peers.values()) {
                this.noteSnapshotsDelayed(peer, [
                    ...peer.snapshotted,
                    ...peer.promisedReady
                ]);
                peer.snapshotted.clear();
            }
            for (const address of this.peerHub.subscribedAddresses())
                this.startBackfill(address);
        } else {
            for (let i = canonical.length - 1; i > ancestor; i--) {
                this.stateCache.applyBackward(canonical[i]);
            }
        }
        canonical.splice(restarts ? 0 : ancestor + 1);
        canonical.push(...staged);
        const added = below && !restarts ? staged.slice(1) : staged;
        for (const record of added) {
            this.stateCache.applyForward(record);
            // complete accounts the block's trace names, with the entries the
            // cache holds after it: a trace can name an account yet omit its write
            for (const address of Object.keys(record.touches))
                if (this.stateCache.isComplete(address))
                    this.recountEntries(address, {
                        block: record,
                        cached: this.stateCache.nonZeroSlots(address)
                    });
        }
        canonical.splice(0, Math.max(0, canonical.length - this.retention));
        for (const record of added) this.peerHub.publish(record);
        this.endReachedWaits();
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
            // how long a new head took to commit after it was announced
            this.backstop.record(Date.now() - woke);
        }).catch((error) => this.fail(error));
    }

    private async fetchHeader(
        by: "latest" | bigint | string
    ): Promise<BlockHeader> {
        const byHash = typeof by === "string" && by !== "latest";
        const block = await this.request(
            byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber",
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
     * The trace names what the block touched. Its values are kept for a block
     * in which no call frame failed; otherwise the values of what the watched
     * accounts touched are read from the node, pinned to the block hash.
     * Those reads take `pre` values from the cache when the cache is at the
     * parent of the first block (`preFrom` "cache"), carried forward block by
     * block over what the staged blocks read; from the node at the parent
     * block otherwise. Each record gets the logs of the subscribed addresses
     * its bloom matches. A block that fails to stage is pushed as
     * `trace-failed`.
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

    /** `stage`'s work; `progress` names the block being staged. */
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
     * together. A `callTracer` answer that is an error is `undefined`: the
     * caller then reads values from the node.
     */
    private async traceBlock(
        number: bigint
    ): Promise<{ traces: unknown; calls: unknown }> {
        const [traces, calls] = await Promise.all([
            this.request("debug_traceBlockByNumber", [
                toQuantity(number),
                TRACE_OPTIONS
            ]),
            this.request("debug_traceBlockByNumber", [
                toQuantity(number),
                CALL_TRACE_OPTIONS
            ]).catch(() => undefined)
        ]);
        return { traces, calls };
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
     * Reads the values `addresses` have at `record`'s block for what the
     * block touched of them, and the values before it, and keeps what
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
        if (fields.length === 0) return;
        // a block before this one in the step read the field; else the cache is at the step's parent
        const before = fields.map(
            (field) =>
                running.get(fieldKey(field)) ??
                (preFrom === "cache" ? this.stateCache.get(field) : undefined)
        );
        let posts: StateValue[];
        let pres: (StateValue | undefined)[];
        try {
            [posts, pres] = await this.retryTransient(
                () =>
                    Promise.all([
                        Promise.all(
                            fields.map((field) =>
                                this.fetchField(field, record.hash)
                            )
                        ),
                        Promise.all(
                            fields.map((field, i) =>
                                before[i] === undefined
                                    ? this.fetchField(field, record.parentHash)
                                    : undefined
                            )
                        )
                    ]),
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
        fields.forEach((field, i) => {
            const post = posts[i];
            running.set(fieldKey(field), post);
            const pre = before[i] ?? pres[i]!;
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
     * Holds `addresses` watched until `release`: the values of each are kept
     * in every record staged from now on, and the retained records staged
     * before are filled. Settles when they hold them all. Past the watched
     * limit the least recently used accounts nobody holds are dropped, with
     * their cached values; when those are too few, or `peer` would hold more
     * than its share, nothing is held. Without a peer the hold is the
     * service's own, outside every connection's share.
     */
    private hold(
        peer: StorageDiffPeer | undefined,
        addresses: AccountAddress[]
    ): Promise<void> {
        const wanted = new Set(addresses);
        const added = [...wanted].filter(
            (address) => !peer?.held.has(address)
        ).length;
        if (
            peer &&
            peer.held.size + added > this.maxWatchedAddressesPerConnection
        )
            throw rpcError(
                LIMIT_EXCEEDED_ERROR_CODE,
                `A connection may hold at most ${this.maxWatchedAddressesPerConnection} addresses`
            );
        let excess =
            this.watched.size +
            [...wanted].filter((address) => !this.watched.has(address)).length -
            this.maxWatchedAddresses;
        const dropped: AccountAddress[] = [];
        for (const [address, account] of this.watched) {
            if (excess <= 0) break;
            if (account.holders > 0 || wanted.has(address)) continue;
            dropped.push(address);
            excess--;
        }
        if (excess > 0)
            throw rpcError(
                LIMIT_EXCEEDED_ERROR_CODE,
                `The service watches at most ${this.maxWatchedAddresses} addresses, all of them in use`
            );
        for (const address of dropped) {
            this.watched.delete(address);
            this.stateCache.forget(address);
            // a later watch tries its backfill again
            this.lazyAccounts.delete(address);
        }
        for (const address of wanted) {
            let account = this.watched.get(address);
            if (!account || account.failed) {
                // later blocks cover it from here; the fill covers the earlier ones
                const filled = this.enqueue(() => this.fillHistory(address));
                account ??= { filled, failed: false, holders: 0 };
                account.filled = filled;
                account.failed = false;
                const filling = account;
                filled.catch(() => {
                    if (filling.filled === filled) filling.failed = true;
                });
            }
            account.holders++;
            peer?.held.set(address, (peer.held.get(address) ?? 0) + 1);
            // most recently used last
            this.watched.delete(address);
            this.watched.set(address, account);
        }
        return Promise.all(
            [...wanted].map((address) => this.watched.get(address)!.filled)
        ).then(() => undefined);
    }

    /** Ends one hold of each of `addresses`; they stay watched until dropped. */
    private release(
        peer: StorageDiffPeer | undefined,
        addresses: AccountAddress[]
    ): void {
        for (const address of new Set(addresses)) {
            const account = this.watched.get(address);
            if (account) account.holders--;
            if (!peer) continue;
            const holds = peer.held.get(address)! - 1;
            if (holds === 0) peer.held.delete(address);
            else peer.held.set(address, holds);
        }
    }

    /** A closed connection's subscriptions hold their accounts no more. */
    private disconnected(peer: StorageDiffPeer): void {
        for (const addresses of peer.subscriptions.values())
            this.release(peer, addresses);
        peer.subscriptions.clear();
    }

    private assertAddressCount(addresses: AccountAddress[]): void {
        if (new Set(addresses).size > this.maxAddressesPerRequest)
            throw invalidParams(
                `A request may name at most ${this.maxAddressesPerRequest} addresses`
            );
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

    private assertRetained(blockHash: string): void {
        if (this.retainedIndex(blockHash) < 0) {
            throw rpcError(NOT_RETAINED_ERROR_CODE, "Block is not retained");
        }
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
     * Starts one upstream read for every field that is neither cached nor
     * being fetched, all at once, pinned to the best head. Each field gets
     * its own flight.
     */
    private fetchMissing(fields: StateField[]): void {
        const pinned = this.canonical[this.canonical.length - 1].hash;
        for (const field of fields) {
            const key: FlightKey = JSON.stringify(field);
            if (
                this.stateCache.get(field) !== undefined ||
                this.flights.has(key)
            )
                continue;
            const flight = this.loadField(field, {
                pinned,
                value: this.limitStateFetch(() =>
                    this.fetchField(field, pinned)
                )
            }).finally(() => this.flights.delete(key));
            this.flights.set(key, flight);
        }
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
        // a value of an account dropped meanwhile would not follow the chain
        const watching = this.watched.get(field.address);
        await this.retryWhileChainMoves(async () => {
            const pinned =
                unused?.pinned ??
                this.canonical[this.canonical.length - 1].hash;
            // the first try is the read already started; a retry asks again
            const issued = unused;
            unused = undefined;
            const value = await this.retryTransient(
                () =>
                    issued
                        ? issued.value.catch((error) => {
                              issued.value = this.limitStateFetch(() =>
                                  this.fetchField(field, pinned)
                              );
                              throw error;
                          })
                        : this.limitStateFetch(() =>
                              this.fetchField(field, pinned)
                          ),
                "Retrying the state fetch"
            );
            const index = this.retainedIndex(pinned);
            if (index < 0)
                throw new HeadChangedError(
                    "The chain moved while state was fetched"
                );
            const scratch = new StateCache();
            scratch.set(field, value);
            for (let i = index + 1; i < this.canonical.length; i++) {
                scratch.applyForward(this.canonical[i]);
            }
            if (this.watched.get(field.address) === watching)
                this.stateCache.set(field, scratch.get(field)!);
        });
    }

    /** Runs a state read for a peer once fewer than `MAX_STATE_FETCHES_IN_FLIGHT` are at the upstream. */
    private limitStateFetch<T>(read: () => Promise<T>): Promise<T> {
        return this.limitFetch(read, this.stateFetchWaiters);
    }

    /** Runs a backfill's read within the same limit, behind every peer read that waits. */
    private limitBackfillFetch<T>(read: () => Promise<T>): Promise<T> {
        return this.limitFetch(read, this.backfillFetchWaiters);
    }

    /** Runs `read` once a place is free, waiting in `waiters`; a freed place goes to a peer's read first. */
    private async limitFetch<T>(
        read: () => Promise<T>,
        waiters: (() => void)[]
    ): Promise<T> {
        while (this.stateFetchesInFlight >= MAX_STATE_FETCHES_IN_FLIGHT)
            await new Promise<void>((resolve) => waiters.push(resolve));
        this.stateFetchesInFlight++;
        try {
            return await read();
        } finally {
            this.stateFetchesInFlight--;
            (
                this.stateFetchWaiters.shift() ??
                this.backfillFetchWaiters.shift()
            )?.();
        }
    }

    /** The value of `field` at exactly block `blockHash` (EIP-1898). */
    private async fetchField(
        field: StateField,
        blockHash: string
    ): Promise<StateValue> {
        const at = { blockHash };
        const { address } = field;
        if (field.kind === "slot") {
            return this.parseField(
                field,
                await this.request("eth_getStorageAt", [
                    address,
                    field.slot,
                    at
                ])
            );
        }
        const method = {
            balance: "eth_getBalance",
            nonce: "eth_getTransactionCount",
            code: "eth_getCode"
        }[field.kind];
        return this.parseField(
            field,
            await this.request(method, [address, at])
        );
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

    /**
     * Resolves once the best head is at `minBlock` or higher, or at the first
     * of: the service saying the block is late (`noteDelay`: its tracing
     * failed or is retried, or the upstream has not seen the block), the
     * service closing, or the learned backstop for a service that hangs
     * silently. A caller then answers with what the service holds.
     */
    private async reachHead(minBlock: bigint | undefined): Promise<void> {
        if (
            minBlock === undefined ||
            BigInt(this.canonical[this.canonical.length - 1].number) >=
                minBlock ||
            this.stopping.signal.aborted
        )
            return;
        await new Promise<void>((resolve) => {
            const waiter: HeadWaiter = {
                minBlock,
                end: () => {
                    clearTimeout(timer);
                    this.headWaiters.delete(waiter);
                    resolve();
                }
            };
            const timer = setTimeout(waiter.end, this.backstop.boundMs);
            this.headWaiters.add(waiter);
            this.probeUpstreamHead();
        });
    }

    /** Ends the waits the best head has reached. */
    private endReachedWaits(): void {
        const head = BigInt(this.canonical[this.canonical.length - 1].number);
        for (const waiter of [...this.headWaiters])
            if (waiter.minBlock <= head) waiter.end();
    }

    /**
     * Asks the upstream for its newest block number, one ask in flight for
     * every wait, within the limit of state reads for peers; a wait that
     * starts meanwhile gets one more ask after it. A block the upstream has
     * not seen cannot arrive soon. A failed ask leaves the waits to the
     * backstop.
     */
    private probeUpstreamHead(): void {
        if (this.upstreamHeadProbe) {
            this.upstreamHeadProbeAgain = true;
            return;
        }
        const asked = [...this.headWaiters];
        this.upstreamHeadProbe = (async () => {
            try {
                const answer = await this.limitStateFetch(() =>
                    this.request("eth_blockNumber", [])
                );
                if (typeof answer === "string")
                    this.noteUpstreamBehind(BigInt(answer), asked);
            } catch {
                // the backstop ends the waits
            }
        })().finally(() => {
            this.upstreamHeadProbe = undefined;
            if (!this.upstreamHeadProbeAgain) return;
            this.upstreamHeadProbeAgain = false;
            if (this.headWaiters.size > 0) this.probeUpstreamHead();
        });
    }

    /**
     * Tells the peers about the lowest block of the waits in `asked` that the
     * upstream, at block `seen`, has not seen: that ends every wait for it or
     * a later block.
     */
    private noteUpstreamBehind(seen: bigint, asked: HeadWaiter[]): void {
        const late = asked
            .filter((waiter) => this.headWaiters.has(waiter))
            .map((waiter) => waiter.minBlock)
            .filter((minBlock) => minBlock > seen);
        if (late.length === 0) return;
        const lowest = late.reduce((a, b) => (b < a ? b : a));
        const head = this.canonical[this.canonical.length - 1];
        this.noteDelay({
            reason: "upstream-behind",
            requested: toQuantity(lowest),
            head: { number: head.number, hash: head.hash }
        });
    }

    /**
     * Ends the waits the notice makes pointless and pushes it to the
     * subscribed peers. A block that fails to trace holds back every block
     * after it, so it ends every wait; an upstream that has not seen block N
     * ends the waits for N or later.
     */
    private noteDelay(notice: StorageDiffDelayNotice): void {
        for (const waiter of [...this.headWaiters]) {
            if (
                notice.reason === "trace-failed" ||
                (notice.reason === "upstream-behind" &&
                    waiter.minBlock >= BigInt(notice.requested))
            )
                waiter.end();
        }
        if (notice.reason === "upstream-behind") {
            const told = `${notice.requested}@${notice.head.hash}`;
            // the peers have this one, and the head has not moved since
            if (told === this.lastUpstreamBehind) return;
            this.lastUpstreamBehind = told;
        }
        for (const peer of this.peerHub.peers.values()) {
            if (peer.closing || peer.subscriptions.size === 0) continue;
            this.peerHub.pushDelay(peer, notice);
        }
    }

    /**
     * Adds to `block` the logs of those of `addresses` its bloom matches and
     * that it has none fetched for, with one `eth_getLogs` by block hash. An
     * address another fetch logged meanwhile keeps the logs it got.
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
        const fresh = missing.filter(
            (address) => !block.loggedAddresses.has(address)
        );
        const fetched = parseLogs(answer).filter((log) =>
            fresh.includes(log.address)
        );
        for (const address of fresh) block.loggedAddresses.add(address);
        block.logs = [...block.logs, ...fetched].sort((a, b) =>
            Number(BigInt(a.logIndex) - BigInt(b.logIndex))
        );
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

    /**
     * One `eth_getBlockReceipts`, or one receipt read per transaction where
     * the node does not know that method.
     */
    private async fetchReceipts(block: StagedBlock): Promise<unknown[]> {
        const transactions = block.raw.transactions as { hash: string }[];
        if (this.blockReceiptsSupported) {
            try {
                const receipts = await this.limitStateFetch(() =>
                    this.request("eth_getBlockReceipts", [block.hash])
                );
                if (
                    !Array.isArray(receipts) ||
                    receipts.length !== transactions.length
                )
                    throw new Error("Receipts do not cover the block");
                return receipts;
            } catch (error) {
                if (
                    !(error instanceof UpstreamRequestError) ||
                    error.upstreamCode !== METHOD_NOT_FOUND_CODE
                )
                    throw error;
                this.blockReceiptsSupported = false;
            }
        }
        const receipts = await Promise.all(
            transactions.map((transaction) =>
                this.limitStateFetch(() =>
                    this.request("eth_getTransactionReceipt", [
                        transaction.hash
                    ])
                )
            )
        );
        // a node that has not indexed the block yet answers null
        if (
            receipts.some(
                (receipt, i) =>
                    !isObject(receipt) ||
                    receipt.transactionHash !== transactions[i].hash
            )
        )
            throw new Error("Receipts do not cover the block");
        return receipts;
    }

    /**
     * Starts rebuilding `address` from its history, unless that is done or
     * running; it waits while `BACKFILLS_AT_ONCE` others read.
     */
    private startBackfill(address: AccountAddress): void {
        if (
            this.backfills.has(address) ||
            this.lazyAccounts.has(address) ||
            this.stateCache.isComplete(address) ||
            this.stopping.signal.aborted
        )
            return;
        // Set once the backfill holds the account: from when it gets its
        // place until it is done, so a waiting backfill holds nothing.
        let held = false;
        const job = this.takeBackfillPlace()
            .then(async () => {
                try {
                    // a backfill no subscription names any more costs nothing
                    if (
                        this.stopping.signal.aborted ||
                        !this.peerHub.subscribedAddresses().includes(address)
                    )
                        return;
                    // the records keep its values while it runs, so it is never dropped meanwhile
                    const filled = this.hold(undefined, [address]);
                    held = true;
                    await this.runBackfill(address, filled);
                } finally {
                    this.backfillsRunning--;
                    this.backfillWaiters.shift()?.();
                }
            })
            .catch((error) => {
                if (this.stopping.signal.aborted) return;
                this.logger.warn(
                    "Backfill failed; the account is read lazily",
                    {
                        address,
                        reason: this.failureReason(error)
                    }
                );
                // lazy until the cache is cleared; the subscribers are told
                // now, so they do not wait for a snapshot
                return this.enqueue(async () => {
                    this.lazyAccounts.add(address);
                    for (const peer of this.peerHub.peers.values())
                        if (!peer.closing) this.sendSnapshots(peer, [address]);
                });
            })
            .finally(() => {
                this.backfills.delete(address);
                if (held) this.release(undefined, [address]);
            });
        this.backfills.set(address, job);
    }

    /** Resolves once fewer than `BACKFILLS_AT_ONCE` backfills read, taking a place. */
    private async takeBackfillPlace(): Promise<void> {
        while (
            this.backfillsRunning >= BACKFILLS_AT_ONCE &&
            !this.stopping.signal.aborted
        )
            await new Promise<void>((resolve) =>
                this.backfillWaiters.push(resolve)
            );
        this.backfillsRunning++;
    }

    /**
     * Reads the contract's history up to the best head, in rounds: the keys
     * its traces name (never their values) up to a block inside the retained
     * window, where the window's own records add the rest. Then the values of
     * all those keys are read at one block, the head, and the records after
     * it are applied. A covered block that a reorg orphaned starts over.
     */
    private async runBackfill(
        address: AccountAddress,
        filled: Promise<void>
    ): Promise<void> {
        const started = Date.now();
        await filled;
        let restarts = 0;
        let covered: { number: bigint; hash: string } | undefined;
        let keys = new Set<StorageSlot>();
        const fresh = (): BackfillRecord => ({
            address,
            codeProbes: 0,
            blockReads: 0,
            rootReads: 0,
            traces: 0,
            stateReads: 0,
            blocks: 0,
            tracedBlocks: 0,
            slots: 0,
            milliseconds: 0
        });
        let record = fresh();
        for (let round = 0; round < BACKFILL_ROUNDS; round++) {
            if (this.stopping.signal.aborted) return;
            const tipRecord = this.canonical[this.canonical.length - 1];
            const tip = {
                number: BigInt(tipRecord.number),
                hash: tipRecord.hash
            };
            try {
                if (!covered) {
                    const deploy = await this.findDeployBlock(
                        address,
                        tip.number,
                        record
                    );
                    if (deploy !== undefined) {
                        for (const slot of await this.backfillKeys(
                            address,
                            deploy,
                            tip,
                            record
                        ))
                            keys.add(slot);
                        record.deployBlock = toQuantity(deploy);
                    }
                    covered = tip;
                } else if (tip.number > covered.number) {
                    for (const slot of await this.backfillKeys(
                        address,
                        covered.number + 1n,
                        tip,
                        record,
                        covered.hash
                    ))
                        keys.add(slot);
                    covered = tip;
                }
                const prepared = await this.enqueue(() =>
                    this.prepareBackfill(address, covered!, keys)
                );
                if (prepared === "again") continue;
                if (prepared === "restart")
                    throw new ChainMovedError("Covered block dropped");
                // the values at the head, read outside the queue
                const state = await this.readBackfillState(
                    address,
                    prepared.anchor.hash,
                    prepared.keys,
                    record
                );
                // a chain that holds other entries than the history named is not backfilled whole
                // (Asset Hub's tracer can omit a constructor's repeated write: paritytech/polkadot-sdk#13663)
                const held = await this.backfillBlocks.countStorageEntries(
                    this.backfillUpstream,
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
                record.slots = slots;
                record.milliseconds = Date.now() - started;
                this.logger.info("Backfilled an account", { ...record });
                return;
            } catch (error) {
                // a reorg moved blocks under the read: read the range again
                if (
                    !(error instanceof ChainMovedError || isTransient(error)) ||
                    ++restarts > BACKFILL_RESTARTS
                )
                    throw error;
                covered = undefined;
                keys = new Set();
                record = fresh();
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
            { balance: state.balance, nonce: state.nonce, code: state.code },
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
        for (const peer of this.peerHub.peers.values()) {
            if (!peer.closing) this.sendSnapshots(peer, [address]);
        }
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
            this.peerHub.send(peer.socket, {
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
            this.peerHub.dropIfLagging(peer);
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
            this.peerHub.pushDelay(peer, {
                reason: "snapshot-delayed",
                subscription,
                block: { number: head.number, hash: head.hash },
                accounts
            });
        }
        for (const address of addresses) peer.promisedReady.delete(address);
    }

    /**
     * The first block of 0..`tip` whose state has the contract's code, or
     * undefined when `tip` has none. One probe at `tip`, then a bisection.
     */
    private async findDeployBlock(
        address: AccountAddress,
        tip: bigint,
        record: BackfillRecord
    ): Promise<bigint | undefined> {
        if (!(await this.hasCode(address, tip, record))) return undefined;
        let low = 0n;
        let high = tip;
        while (low < high) {
            const middle = (low + high) / 2n;
            if (await this.hasCode(address, middle, record)) high = middle;
            else low = middle + 1n;
        }
        return high;
    }

    private async hasCode(
        address: AccountAddress,
        block: bigint,
        record: BackfillRecord
    ): Promise<boolean> {
        record.codeProbes++;
        try {
            // not retried on its own: a failed probe starts the backfill over
            const code = await this.limitBackfillFetch(() =>
                this.request("eth_getCode", [address, toQuantity(block)])
            );
            return typeof code === "string" && code !== "0x";
        } catch (error) {
            // Asset Hub answers this before its contracts pallet existed: no
            // code there. Any other error is no answer and is retried.
            if (
                error instanceof UpstreamRequestError &&
                error.message.includes(NOT_SUPPORTED_AT_BLOCK)
            )
                return false;
            throw error;
        }
    }

    /**
     * The keys the traces of the blocks of `from`..`tip.number` that the
     * backfill block source lists name for the contract. A trace is only
     * used for which keys, never for what is in them.
     */
    private async backfillKeys(
        address: AccountAddress,
        from: bigint,
        tip: { number: bigint; hash: string },
        record: BackfillRecord,
        parentHash?: string
    ): Promise<Set<StorageSlot>> {
        const listing = await this.backfillBlocks.listBlocks(
            this.backfillUpstream,
            address,
            from,
            tip,
            parentHash
        );
        record.blockReads += listing.blockReads;
        record.rootReads += listing.rootReads;
        record.blocks += listing.blocks;
        record.tracedBlocks += listing.numbers.length;
        const keys = new Set<StorageSlot>();
        for (
            let i = 0;
            i < listing.numbers.length;
            i += BACKFILL_TRACES_AT_ONCE
        ) {
            const numbers = listing.numbers.slice(
                i,
                i + BACKFILL_TRACES_AT_ONCE
            );
            record.traces += numbers.length;
            const traces = await Promise.all(
                numbers.map((number) =>
                    this.backfillUpstream.request("debug_traceBlockByNumber", [
                        toQuantity(number),
                        TRACE_OPTIONS
                    ])
                )
            );
            for (const trace of traces)
                for (const slot of touchesOf(trace)[address]?.slots ?? [])
                    keys.add(slot);
        }
        return keys;
    }

    /**
     * The contract's balance, nonce and code, and the value of each of `keys`,
     * at block `blockHash`, read and checked like every field the service
     * reads. Never-touched slots are zero, so the result is complete.
     */
    private async readBackfillState(
        address: AccountAddress,
        blockHash: string,
        keys: Iterable<StorageSlot>,
        record: BackfillRecord
    ): Promise<BackfilledState> {
        const slots = [...keys];
        const read = (field: StateField) => {
            record.stateReads++;
            return this.retryTransient(
                () =>
                    this.limitBackfillFetch(() =>
                        this.fetchField(field, blockHash)
                    ),
                "Retrying a backfill read"
            );
        };
        const [balance, nonce, code, ...words] = await Promise.all([
            read({ kind: "balance", address }),
            read({ kind: "nonce", address }),
            read({ kind: "code", address }),
            ...slots.map((slot) => read({ kind: "slot", address, slot }))
        ]);
        const storage: Record<StorageSlot, string> = {};
        slots.forEach((slot, i) => {
            const word = words[i] as string;
            if (BigInt(word) !== 0n) storage[slot] = word;
        });
        return {
            balance: balance as string,
            nonce: nonce as number,
            code: code as string,
            storage
        };
    }

    /**
     * Counts, on the chain, the storage entries of a complete account a
     * block's trace names and compares them with what the cache holds after
     * that block (a source that cannot count never refuses). One count runs
     * per account at a time: blocks named meanwhile are counted once more, at
     * the newest.
     * An account that differs stays lazy from then on, as after a backfill
     * that came up short.
     */
    private recountEntries(
        address: AccountAddress,
        written: { block: StagedBlock; cached: number }
    ): void {
        const running = this.recounts.get(address);
        if (running) {
            running.next = written;
            return;
        }
        const recount: Recount = {};
        this.recounts.set(address, recount);
        void (async () => {
            let next: typeof recount.next = written;
            while (next && !this.stopping.signal.aborted) {
                await this.recountAt(address, next);
                next = recount.next;
                recount.next = undefined;
            }
            this.recounts.delete(address);
        })();
    }

    private async recountAt(
        address: AccountAddress,
        { block, cached }: { block: StagedBlock; cached: number }
    ): Promise<void> {
        try {
            const held = await this.backfillBlocks.countStorageEntries(
                this.backfillUpstream,
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
                    if (!peer.closing) this.sendSnapshots(peer, [address]);
                }
            });
        } catch (error) {
            if (!this.stopping.signal.aborted)
                this.logger.warn("Cannot count an account's entries", {
                    address,
                    reason: this.failureReason(error)
                });
        }
    }

    private retainedIndex(blockHash: string): number {
        return this.canonical.findIndex((record) => record.hash === blockHash);
    }

    /** Runs `job` again at once while the chain moves under it. */
    private async retryWhileChainMoves<T>(job: () => Promise<T>): Promise<T> {
        return await retry(job, {
            maxRetries: RECONCILE_RETRY_LIMIT,
            signal: this.stopping.signal,
            shouldRetry: (error) => error instanceof HeadChangedError
        });
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
            for (const waiter of [...this.headWaiters]) waiter.end();
            for (const wake of this.backfillWaiters.splice(0)) wake();
            this.upstream.destroy();
            this.backfillBlocks.close();
            await this.peerHub.close();
            if (reason) this.settleClosed.reject(reason);
            else this.settleClosed.resolve();
        })();
        return this.shutdown;
    }
}
