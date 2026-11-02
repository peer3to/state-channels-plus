import {
    environmentOf,
    filterRecord,
    NOT_RETAINED_ERROR_CODE,
    parseHeader,
    PRUNED_ERROR_CODE,
    rpcError,
    type AccountAddress,
    type AccountDiffs,
    type BlockEnvironment,
    type BlockHeader,
    type StagedBlock,
    type SubscribeResult,
    type SubscriptionId
} from "./blockStorageDiff";
import { PeerHub, type StorageDiffPeer } from "./PeerHub";
import { type StateRequest } from "./rpcParams";
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
import type {
    StorageDiffCatchUp,
    StorageDiffState
} from "../../storageDiff/storageDiffWire";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import type { Logger } from "@/utils";
import { retry } from "@/utils/retry";
import { toQuantity } from "ethers";

const DEFAULT_RETENTION_BLOCKS = 128;
export type { StorageDiffCatchUp, StorageDiffState };

const DEFAULT_MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
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

/** Identifies one state fetch in flight: a `StateField` as text. */
type FlightKey = string;

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
    logger: Logger;
}

/** The upstream answered a request with an error. */
class UpstreamRequestError extends Error {}

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
 * roll back with it on a reorg.
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
    private readonly stopping = new AbortController();
    private readonly upstream: RpcNodeProvider;
    private canonical: StagedBlock[] = [];
    // Account and slot values at the best head; every upstream read fills it.
    private readonly stateCache = new StateCache();
    // Accounts the service keeps the values of in every record it stages: one
    // entry per account, settled when the retained records hold them too.
    private readonly watched = new Map<AccountAddress, Promise<void>>();
    // One fetch per missing field, shared by every reader waiting for it.
    private readonly flights = new Map<FlightKey, Promise<void>>();
    // State reads at the upstream now, and the ones waiting for a free place.
    private stateFetchesInFlight = 0;
    private readonly stateFetchWaiters: (() => void)[] = [];
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
        this.upstream = new RpcNodeProvider(options.upstreamUrl, this.logger);
        this.peerHub = new PeerHub({
            host: options.host ?? "127.0.0.1",
            port: options.port ?? DEFAULT_PORT,
            maxPeerBufferedBytes:
                options.maxPeerBufferedBytes ?? DEFAULT_MAX_PEER_BUFFERED_BYTES,
            createMethods: (peer) => new StorageDiffRpcMethods(this, peer),
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
            // the records keep these accounts' values from the next block on
            for (const address of addresses) void this.watch(address);
            return { subscription: id };
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
            return {
                records: this.canonical
                    .filter((record) => BigInt(record.number) >= fromBlock)
                    .map((record) => filterRecord(record, addresses)),
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

    /** The environment of the best head. */
    getHead(): BlockEnvironment {
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
     * One upstream request. An error answer becomes `UpstreamRequestError`,
     * and an answer that takes longer than the request timeout (a reconnect
     * included) `UpstreamTimeoutError`: both are retried.
     */
    private async request(method: string, params: unknown[]): Promise<unknown> {
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
                this.upstream.send(method, params).catch((error: unknown) => {
                    if (this.stopping.signal.aborted) throw error;
                    throw new UpstreamRequestError(describeError(error));
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
        } else {
            for (let i = canonical.length - 1; i > ancestor; i--) {
                this.stateCache.applyBackward(canonical[i]);
            }
        }
        canonical.splice(ancestor + 1);
        canonical.push(...staged);
        for (const record of staged.slice(below ? 1 : 0))
            this.stateCache.applyForward(record);
        canonical.splice(0, Math.max(0, canonical.length - this.retention));
        for (const record of staged.slice(below ? 1 : 0))
            this.peerHub.publish(record);
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
        }).catch((error) => this.fail(error));
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

    /**
     * Traces each header's block once, in order; empty blocks need no trace.
     * The trace names what the block touched. Its values are kept for a block
     * in which no call frame failed; otherwise the values of what the watched
     * accounts touched are read from the node, pinned to the block hash.
     * Those reads take `pre` values from the cache when the cache is at the
     * parent of the first block (`preFrom` "cache"), carried forward block by
     * block over what the staged blocks read; from the node at the parent
     * block otherwise.
     */
    private async stage(
        headers: BlockHeader[],
        preFrom: "cache" | "chain"
    ): Promise<StagedBlock[]> {
        const records: StagedBlock[] = [];
        // the value each field has after the blocks staged so far
        const running = new Map<FieldKey, StateValue>();
        for (const header of headers) {
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
                covered: new Set()
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
            this.stateCache.set(field, scratch.get(field)!);
        });
    }

    /** Runs a state read for a peer once fewer than `MAX_STATE_FETCHES_IN_FLIGHT` are at the upstream. */
    private async limitStateFetch<T>(read: () => Promise<T>): Promise<T> {
        while (this.stateFetchesInFlight >= MAX_STATE_FETCHES_IN_FLIGHT)
            await new Promise<void>((resolve) =>
                this.stateFetchWaiters.push(resolve)
            );
        this.stateFetchesInFlight++;
        try {
            return await read();
        } finally {
            this.stateFetchesInFlight--;
            this.stateFetchWaiters.shift()?.();
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
            this.upstream.destroy();
            await this.peerHub.close();
            if (reason) this.settleClosed.reject(reason);
            else this.settleClosed.resolve();
        })();
        return this.shutdown;
    }
}
