import { getReconnectDelayMs } from "../RpcNodeProvider";
import {
    type BlockNumber,
    FollowedChain,
    type MirrorBlock
} from "./FollowedChain";
import { type AnnouncingNode, HeadFreshness } from "./HeadFreshness";
import type { MirrorStateManager } from "./MirrorStateManager";
import { MirrorUnavailableError } from "./MirrorUnavailableError";
import { SnapshotWaits } from "./SnapshotWaits";
import {
    StorageDiffNotRetainedError,
    StorageDiffPrunedError,
    StorageDiffRefusedError,
    StorageDiffSocket
} from "./StorageDiffSocket";
import type { Logger } from "@/utils/logging/Logger";
import { Mutex } from "@/utils/Mutex";
import {
    capLeavingNodeRoundTrips,
    RecentSlowest,
    SDK_RPC_DEADLINE_MS
} from "@/utils/storageDiff/LearnedBackstop";
import type {
    AccountAddress,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    StateRequestParams,
    StorageDiffCatchUp,
    StorageDiffDelayNotice,
    StorageDiffSnapshot,
    SubscribeResult,
    SubscriptionId
} from "@/utils/storageDiff/storageDiffWire";

/**
 * Passes over one read the mirror makes before giving up on it: each pass
 * fills what the one before found missing.
 */
const MAX_DISCOVERY_PASSES = 256;
/** A block number above any head: a catch-up from it answers the head alone. */
const BEYOND_HEAD = 1n << 64n;
/**
 * Accounts the mirror follows at most unless told otherwise: the service's
 * default limit of addresses one subscribe may name, as every subscribe
 * names them all.
 */
const DEFAULT_MAX_FOLLOWED_ACCOUNTS = 1000;

/** One request to the RPC node, answered with its result. */
export type NodeRequest = (
    method: string,
    params: unknown[]
) => Promise<unknown>;

export type MirrorChainOptions = {
    /** `ws://` URL of the storage diff service. */
    serviceUrl: string;
    state: MirrorStateManager;
    /**
     * What the mirror reads from the RPC node when the service does not
     * retain the head block (answers -32002), at that block's hash.
     */
    requestNode: NodeRequest;
    /** How long the nodes took lately to answer; the waits leave room for it. */
    nodeRoundTrips?: RecentSlowest;
    /**
     * Contracts followed at once, at most the service's limit of addresses
     * per request; past it the least recently read one is no longer followed.
     */
    maxFollowedAccounts?: number;
    logger: Logger;
};

/**
 * Keeps the mirror's state at a head that follows the chain: it opens the
 * storage diff service, tracks the addresses reads touch, applies each
 * block's record, rolls back orphaned blocks and catches up over gaps. One
 * lock orders everything that reads or changes the state: a call, a read, an
 * applied record.
 */
export class MirrorChain {
    private readonly serviceUrl: string;
    private readonly state: MirrorStateManager;
    private readonly requestNode: NodeRequest;
    private readonly logger: Logger;
    /** How long the nodes took lately to answer what the provider forwarded. */
    private readonly nodeRoundTrips: RecentSlowest;
    private readonly lock = new Mutex();
    /** Addresses the open subscription follows, least recently read first. */
    private readonly tracked = new Set<AccountAddress>();
    /** Addresses a subscribe in flight adds: their snapshots may come before its reply. */
    private readonly tracking = new Set<AccountAddress>();
    /**
     * Accounts found to have no code, least recently found first: they are
     * not followed, and what a read needs of them is read at each head.
     */
    private readonly codeless = new Set<AccountAddress>();
    private readonly maxFollowed: number;
    /** The chain the cached state follows. */
    private readonly followed: FollowedChain;
    /** What reads wait for before they run on the head. */
    private readonly freshness: HeadFreshness;
    /** The reads waiting for a snapshot. */
    private readonly snapshotWaits: SnapshotWaits;
    private feed?: StorageDiffSocket;
    private subscription?: SubscriptionId;
    /** Accounts whose missing state is read from the node: the feed's copy was found wrong. */
    private readonly nodeRead = new Set<AccountAddress>();
    /**
     * When the read holding the lock must have its answer, its wait for the
     * service included; unset while a pushed record or snapshot holds it.
     */
    private readDeadline?: number;
    private failedAttempts = 0;
    private retryAfterMs = 0;
    private closed = false;

    constructor(options: MirrorChainOptions) {
        this.serviceUrl = options.serviceUrl;
        this.state = options.state;
        this.requestNode = options.requestNode;
        this.nodeRoundTrips = options.nodeRoundTrips ?? new RecentSlowest();
        this.maxFollowed =
            options.maxFollowedAccounts ?? DEFAULT_MAX_FOLLOWED_ACCOUNTS;
        this.logger = options.logger.child({ component: "RpcMirror" });
        this.followed = new FollowedChain(this.state, {
            onArrived: (number) => this.freshness.noteArrived(number),
            onHeadChanged: () => this.freshness.notifyHeadWaiters(),
            onRolledBack: (hash) => this.freshness.forgetRequiredBlock(hash),
            onCleared: () => {
                this.freshness.forgetAnnouncements();
                this.freshness.notifyHeadWaiters();
            },
            onSnapshotPlaced: (address) =>
                this.snapshotWaits.end(address, "arrived"),
            isNodeRead: (address) => this.nodeRead.has(address),
            isFollowed: (address) =>
                this.tracked.has(address) || this.tracking.has(address)
        });
        this.freshness = new HeadFreshness(
            this.followed,
            () => this.waitCapMs,
            () => this.closed,
            () => this.feed,
            (level, message, meta) => this.log(level, message, meta)
        );
        this.snapshotWaits = new SnapshotWaits(
            () => this.waitCapMs,
            (address) => this.state.isComplete(address)
        );
    }

    /**
     * A read issued from now on waits until the head reaches the newest of
     * the nodes' heads, so it never answers from before an event the peer
     * already saw; see {@link HeadFreshness.requireNumber}.
     */
    requireNumber(
        node: AnnouncingNode,
        number: BlockNumber,
        isHead: boolean
    ): void {
        this.freshness.requireNumber(node, number, isHead);
    }

    /** The newest of the nodes' heads announced to this runtime. */
    get announcedNumber(): bigint {
        return this.freshness.announcedNumber;
    }

    /**
     * Asks the service something that needs none of the cached state: no
     * lock, no wait. The mirror opens the service connection first if it is
     * not open.
     */
    async queryService<T>(
        ask: (feed: StorageDiffSocket, timeoutMs: number) => Promise<T>
    ): Promise<T> {
        // the node answers in the time left when the service does not
        const deadline = Date.now() + this.waitCapMs;
        if (!this.feed) {
            await this.lockBy(deadline);
            this.readDeadline = deadline;
            try {
                await this.ensureFollowing();
            } finally {
                this.readDeadline = undefined;
                this.lock.unlock();
            }
        }
        const feed = this.feed;
        if (!feed) throw new MirrorUnavailableError("Mirror is not following");
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0)
            throw new MirrorUnavailableError(
                "No time is left to ask the storage diff service"
            );
        try {
            return await ask(feed, timeoutMs);
        } catch (error) {
            this.log("warn", "Storage diff service query failed", { error });
            throw new MirrorUnavailableError(
                "Storage diff service query failed"
            );
        }
    }

    /**
     * Forgets the cached state of `address` so that what a read needs of it
     * is fetched again: from the node when the feed's copy is the suspect.
     */
    async dropToLazy(
        address: AccountAddress,
        fromNode: boolean
    ): Promise<void> {
        await this.lock.lock();
        try {
            if (this.closed) return;
            this.state.dropToLazy(address);
            if (fromNode) this.nodeRead.add(address);
        } finally {
            this.lock.unlock();
        }
    }

    /** The block number a service read names as the one its caller saw, if any. */
    get seenBlock(): string | undefined {
        return this.freshness.seenBlock;
    }

    /** A read issued from now on waits until the mirror applied `block`. */
    requireBlock(block: MirrorBlock): void {
        this.freshness.requireBlock(block);
    }

    /**
     * Runs `read` with the state at the head. State the read finds missing
     * is read from the service in one request, tracking the new addresses
     * first, and the read runs again from the start, so one read sees one head.
     * `accessed` is told the accounts the answered read used.
     */
    async run<T>(
        read: (head: MirrorBlock) => Promise<T>,
        accessed?: (accounts: AccountAddress[]) => void
    ): Promise<T> {
        // what the read may spend on the mirror, leaving the node room to answer
        const deadline = Date.now() + this.waitCapMs;
        await this.freshness.waitForRequiredBlock();
        await this.lockBy(deadline);
        this.readDeadline = deadline;
        // The accounts this read used, over all its passes.
        const inUse = new Set<AccountAddress>();
        this.state.takeAccessed();
        try {
            for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
                const head = await this.ensureFollowing();
                // following again may have started from a service that is behind the peer
                if (!this.freshness.holdsRequiredBlock())
                    throw new MirrorUnavailableError(
                        "The mirror is behind the node"
                    );
                let outcome: { value: T } | { error: unknown };
                try {
                    outcome = { value: await read(head) };
                } catch (error) {
                    outcome = { error };
                }
                const misses = this.state.takeMisses();
                for (const address of this.state.takeAccessed())
                    inUse.add(address);
                if (misses.length === 0) {
                    if ("error" in outcome) throw outcome.error;
                    // the accounts this read used are the most recently read
                    for (const address of inUse)
                        if (this.tracked.delete(address))
                            this.tracked.add(address);
                    accessed?.([...inUse]);
                    return outcome.value;
                }
                // the pass ran on placeholders: its outcome is discarded
                await this.fillMisses(misses, inUse);
            }
            throw new MirrorUnavailableError(
                "The read keeps finding state missing"
            );
        } finally {
            this.readDeadline = undefined;
            this.lock.unlock();
        }
    }

    /** The environment of the head block. */
    headEnvironment(): BlockEnvironment {
        return this.followed.headEnvironment();
    }

    /** The hash of block `number` on the chain the copy follows, if it keeps that block. */
    hashAt(number: bigint): string | undefined {
        return this.followed.base ? this.followed.hashAt(number) : undefined;
    }

    async close(): Promise<void> {
        this.closed = true;
        this.freshness.notifyHeadWaiters();
        const feed = this.feed;
        this.feed = undefined;
        await feed?.destroy();
    }

    /**
     * The most any wait may last: the SDK's deadline less what the node
     * needs to answer the read the wait falls back to.
     */
    private get waitCapMs(): number {
        return capLeavingNodeRoundTrips(
            SDK_RPC_DEADLINE_MS,
            this.nodeRoundTrips
        );
    }

    /**
     * Takes the lock unless `deadline` passes first; a read that cannot have
     * it in time goes to the node, and the lock it was queued for is handed on.
     */
    private async lockBy(deadline: number): Promise<void> {
        const acquired = this.lock.lock();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<false>((resolve) => {
            timer = setTimeout(
                () => resolve(false),
                Math.max(0, deadline - Date.now())
            );
        });
        const inTime = await Promise.race([acquired.then(() => true), late]);
        clearTimeout(timer);
        if (inTime) return;
        void acquired.then(() => this.lock.unlock());
        throw new MirrorUnavailableError(
            "The mirror is busy past the read's deadline"
        );
    }

    /**
     * How long a service request may take: what the read holding the lock
     * has left, or the SDK's deadline for a pushed record or snapshot.
     */
    private serviceTimeoutMs(): number {
        return this.readDeadline === undefined
            ? SDK_RPC_DEADLINE_MS
            : Math.max(0, this.readDeadline - Date.now());
    }

    /** A read with no time left for the service goes to the node, the feed untouched. */
    private assertTimeLeft(): void {
        if (this.serviceTimeoutMs() <= 0)
            throw new MirrorUnavailableError(
                "No time is left to ask the storage diff service"
            );
    }

    // Nothing is logged once closed: the owner's logger may be disposed first.
    private log(
        level: "warn" | "info" | "debug",
        message: string,
        meta?: Record<string, unknown>
    ): void {
        if (this.closed) return;
        try {
            this.logger[level](message, meta);
        } catch {
            // the logger was disposed with its owner
        }
    }

    private async ensureFollowing(): Promise<MirrorBlock> {
        if (this.closed) throw new MirrorUnavailableError("Mirror closed");
        if (this.feed && this.followed.base) return this.followed.head!;
        if (Date.now() < this.retryAfterMs)
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        this.assertTimeLeft();
        try {
            if (!this.feed) await this.connect();
            if (!this.followed.base) await this.startFromServiceHead();
            const head = this.followed.head;
            if (!head)
                throw new Error("The mirror lost its head while starting");
            this.failedAttempts = 0;
            return head;
        } catch (error) {
            this.retryAfterMs =
                Date.now() + getReconnectDelayMs(this.failedAttempts++);
            this.log("warn", "Mirror cannot follow the storage diff service", {
                error
            });
            await this.disconnect();
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        }
    }

    private async connect(): Promise<void> {
        const feed: StorageDiffSocket = new StorageDiffSocket(this.serviceUrl, {
            onRecord: (subscription, record) => {
                if (subscription === this.subscription && !this.closed)
                    void this.applyPushed(record);
            },
            // A snapshot comes under the id of the subscribe that added its
            // accounts, which is not always the one records come under.
            onSnapshot: (_subscription, snapshot) => {
                if (!this.closed) this.receiveSnapshot(snapshot);
            },
            onDelayed: (notice) => this.receiveDelay(notice),
            onLost: (reason) => void this.onFeedLost(feed, reason)
        });
        this.feed = feed;
        this.subscription = (
            await feed.subscribe([...this.tracked], this.serviceTimeoutMs())
        ).subscription;
    }

    /** Takes the service's best head as the head. */
    private async startFromServiceHead(): Promise<void> {
        const answer = await this.feed!.catchUp(
            [...this.tracked],
            BEYOND_HEAD,
            this.serviceTimeoutMs()
        );
        const head = answer.head;
        this.followed.begin(head, this.tracked);
    }

    /**
     * Reads what a pass found missing from the service at the head block,
     * after following the addresses it touched; the node answers only when
     * the service does not retain that block.
     */
    private async fillMisses(
        misses: StateRequestParams[],
        inUse: ReadonlySet<AccountAddress>
    ): Promise<void> {
        this.assertTimeLeft();
        for (const miss of misses)
            if (this.codeless.has(miss.address))
                this.state.unfollow(miss.address);
        const added = this.makeRoom(
            misses
                .map((miss) => miss.address)
                .filter(
                    (address) =>
                        !this.tracked.has(address) &&
                        !this.codeless.has(address)
                ),
            inUse
        );
        // registered before following, so a snapshot that comes during it is applied at once
        const snapshots = this.snapshotWaits.expectSnapshots(added);
        try {
            const statuses = await this.track(added);
            // only a snapshot the feed has ready is waited for; a syncing
            // account is read lazily now and takes its snapshot when it comes
            snapshots.release(
                added.filter((address) => statuses[address] !== "ready")
            );
            await snapshots.settled(this.serviceTimeoutMs());
            // following may have cleared the cache; the pass then starts over
            const head = this.followed.head;
            if (!head) return;
            const lacking = this.state.stillMissing(misses);
            if (lacking.length === 0) {
                this.unfollowCodeless(added);
                return;
            }
            const fields = lacking.reduce(
                (sum, miss) =>
                    sum +
                    (miss.slots?.length ?? 0) +
                    (miss.account ? 2 : 0) +
                    (miss.code ? 1 : 0),
                0
            );
            this.log("debug", "Mirror reads state the feed did not push", {
                accounts: lacking.map((miss) => miss.address),
                fields
            });
            const fromNode = lacking.filter((miss) =>
                this.nodeRead.has(miss.address)
            );
            const fromFeed = lacking.filter(
                (miss) => !this.nodeRead.has(miss.address)
            );
            if (fromNode.length > 0)
                this.state.fill(await this.readFromNode(head.hash, fromNode));
            if (fromFeed.length === 0) return;
            try {
                const state = await this.feed!.getState(
                    head.hash,
                    fromFeed,
                    this.serviceTimeoutMs()
                );
                this.state.fill(state.accounts);
            } catch (error) {
                if (!(error instanceof StorageDiffNotRetainedError))
                    throw error;
                this.state.fill(await this.readFromNode(head.hash, fromFeed));
            }
            this.unfollowCodeless(added);
        } catch (error) {
            if (error instanceof MirrorUnavailableError) throw error;
            // a refused request changed nothing: the copy stays, the node answers this read
            if (error instanceof StorageDiffRefusedError) {
                this.log(
                    "info",
                    "The storage diff service refused a request; the node answers the read",
                    { error }
                );
                throw new MirrorUnavailableError(
                    "Storage diff service refused the request"
                );
            }
            this.log("warn", "Mirror cannot read state", { error });
            await this.disconnect();
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        } finally {
            // a read that ends early waits for none of them any more
            snapshots.forget();
        }
    }

    /**
     * The service says a block or snapshot a read may wait for will not come
     * soon: the wait ends and the read goes to the node. A late block matters
     * only to a wait for a block the head lacks, and for an `upstream-behind`
     * notice only when that wait is for the requested block or later.
     */
    private receiveDelay(notice: StorageDiffDelayNotice): void {
        if (this.closed) return;
        this.log("debug", "Storage diff service reports a delay", {
            reason: notice.reason
        });
        if (notice.reason === "snapshot-delayed") {
            for (const address of notice.accounts)
                this.snapshotWaits.delayed(address);
            return;
        }
        this.freshness.receiveBlockDelay(notice);
    }

    /**
     * A snapshot from the feed. While a read waits for it, it is applied at
     * once, catching the head up to its block first; otherwise it waits its
     * turn behind the reads and records in hand.
     */
    private receiveSnapshot(snapshot: StorageDiffSnapshot): void {
        // no snapshot is coming for these: stop waiting, the reads fetch them
        for (const address of snapshot.lazy ?? []) {
            this.snapshotWaits.end(address, "not-coming");
            // the feed found the complete state it pushed before to be short
            if (this.state.isComplete(address))
                void this.dropToLazy(address, false);
        }
        if (Object.keys(snapshot.accounts).length === 0) return;
        const awaited = Object.keys(snapshot.accounts).some((address) =>
            this.snapshotWaits.isAwaited(address)
        );
        // the read waiting for it holds the lock until the snapshot is placed
        if (awaited) this.snapshotWaits.holdWhile(this.applyAwaited(snapshot));
        else void this.applyQueued(snapshot);
    }

    private async applyAwaited(snapshot: StorageDiffSnapshot): Promise<void> {
        try {
            if (!this.followed.base) return;
            while (BigInt(snapshot.block.number) > this.followed.head!.number) {
                const before = this.followed.head!.number;
                await this.catchUp(before + 1n);
                // a catch-up that cleared the chain leaves no block to place it on
                if (!this.followed.base) return;
                if (this.followed.head!.number === before) break;
            }
            this.followed.placeSnapshot(snapshot);
        } catch (error) {
            this.log("warn", "Mirror cannot apply a snapshot", { error });
        }
    }

    private async applyQueued(snapshot: StorageDiffSnapshot): Promise<void> {
        await this.lock.lock();
        try {
            if (!this.followed.base || this.closed) return;
            this.followed.placeSnapshot(snapshot);
        } catch (error) {
            this.log("warn", "Mirror cannot apply a snapshot", { error });
        } finally {
            this.lock.unlock();
        }
    }

    private async readFromNode(
        block: string,
        misses: StateRequestParams[]
    ): Promise<AccountDiffs> {
        const accounts: AccountDiffs = {};
        // pinned to the block's hash: a reorg cannot hand back another block's state
        const at = { blockHash: block };
        const read = async (method: string, params: unknown[]) =>
            String(await this.requestNode(method, [...params, at]));
        try {
            await Promise.all(
                misses.map(async ({ address, slots, account, code }) => {
                    const known = (accounts[address] ??= {});
                    await Promise.all([
                        ...(slots ?? []).map(async (slot) => {
                            (known.storage ??= {})[slot] = await read(
                                "eth_getStorageAt",
                                [address, slot]
                            );
                        }),
                        account &&
                            read("eth_getBalance", [address]).then((v) => {
                                known.balance = v;
                            }),
                        account &&
                            read("eth_getTransactionCount", [address]).then(
                                (v) => {
                                    known.nonce = Number(BigInt(v));
                                }
                            ),
                        code &&
                            read("eth_getCode", [address]).then((v) => {
                                known.code = v;
                            })
                    ]);
                })
            );
        } catch (error) {
            // a node that fails a read ends that read only: the service's feed and the cache stay
            this.log("warn", "The node cannot answer a state read", { error });
            throw new MirrorUnavailableError(
                "The node cannot answer the state read",
                { cause: error }
            );
        }
        return accounts;
    }

    /**
     * Makes room among the followed accounts for `added`: the least recently
     * read ones the running read does not use are no longer followed, and
     * their cached state is forgotten. Returns those of `added` to follow;
     * any others are read at the head only.
     */
    private makeRoom(
        added: AccountAddress[],
        inUse: ReadonlySet<AccountAddress>
    ): AccountAddress[] {
        let excess = this.tracked.size + added.length - this.maxFollowed;
        const evicted: AccountAddress[] = [];
        for (const address of this.tracked) {
            if (excess <= 0) break;
            if (inUse.has(address)) continue;
            evicted.push(address);
            excess--;
        }
        for (const address of evicted) {
            this.tracked.delete(address);
            this.state.dropToLazy(address);
        }
        this.followed.untrack(evicted);
        const follow =
            excess > 0 ? added.slice(0, added.length - excess) : added;
        for (const address of added.slice(follow.length))
            this.state.unfollow(address);
        return follow;
    }

    /**
     * Only contracts stay followed: of `addresses`, an account the cache
     * holds without code is read again at each head instead.
     */
    private unfollowCodeless(addresses: AccountAddress[]): void {
        const codeless = addresses.filter((address) =>
            this.state.hasNoCode(address)
        );
        for (const address of codeless) {
            this.tracked.delete(address);
            this.state.unfollow(address);
            this.codeless.add(address);
        }
        this.followed.untrack(codeless);
        // as many as the followed ones, the oldest forgotten first
        for (const address of this.codeless) {
            if (this.codeless.size <= this.maxFollowed) break;
            this.codeless.delete(address);
        }
    }

    /** Follows `addresses` too: one subscription for the whole set, then a catch-up. */
    private async track(
        addresses: AccountAddress[]
    ): Promise<SubscribeResult["accounts"]> {
        if (addresses.length === 0) return {};
        const head = this.followed.head;
        const feed = this.feed;
        if (!head || !feed)
            throw new MirrorUnavailableError("Mirror is not following");
        const previous = this.subscription;
        for (const address of addresses) this.tracking.add(address);
        let subscribed: SubscribeResult;
        try {
            subscribed = await feed.subscribe(
                [...this.tracked, ...addresses],
                this.serviceTimeoutMs()
            );
            this.subscription = subscribed.subscription;
            for (const address of addresses) this.tracked.add(address);
        } finally {
            for (const address of addresses) this.tracking.delete(address);
        }
        this.followed.trackFrom(addresses, head.number);
        // the service keeping a superseded subscription costs only pushes the
        // new one also carries, so a failed unsubscribe keeps the connection
        if (previous)
            await feed
                .unsubscribe(previous, this.serviceTimeoutMs())
                .catch((error) => {
                    this.log(
                        "warn",
                        "Mirror cannot drop its previous subscription",
                        {
                            error
                        }
                    );
                });
        try {
            await this.catchUp(head.number + 1n);
        } catch (error) {
            if (!(error instanceof StorageDiffRefusedError)) throw error;
            // the records after the head may lack the accounts just followed:
            // the copy cannot be trusted, so the connection starts over
            throw new Error(
                "The catch-up of newly followed accounts was refused"
            );
        }
        return subscribed.accounts;
    }

    /** Applies a pushed record once every earlier read and record is done. */
    private async applyPushed(record: BlockStorageDiff): Promise<void> {
        await this.lock.lock();
        try {
            if (!this.followed.base || this.closed) return;
            await this.apply(record);
        } catch (error) {
            // a refused catch-up changed nothing: the next record or read catches up
            if (error instanceof StorageDiffRefusedError) {
                this.log(
                    "info",
                    "The storage diff service refused a catch-up",
                    { error }
                );
                return;
            }
            this.log("warn", "Mirror cannot apply a pushed record", { error });
            await this.disconnect();
        } finally {
            this.lock.unlock();
        }
    }

    /** Puts `record` on the chain the mirror follows, or catches up. */
    private async apply(record: BlockStorageDiff): Promise<void> {
        const head = this.followed.head!;
        const number = BigInt(record.number);
        // below what the mirror keeps: the service's chain moved below the
        // blocks the copy holds, a reorg deeper than its rollback reach
        if (number < this.followed.base!.number) {
            this.log(
                "info",
                "A record is older than the blocks the mirror keeps; clearing the cache"
            );
            this.followed.clear();
            return;
        }
        if (this.followed.hashAt(number) === record.hash) return;
        if (this.followed.attach(record)) return;
        // the parent is not a block the mirror holds: a gap, or a branch
        // that starts below what it kept
        await this.catchUp(
            number > head.number + 1n
                ? head.number + 1n
                : this.followed.base!.number + 1n
        );
        // the catch-up did not reach the record: the copy is on a branch
        // the service left at or below the block it began from
        if (
            this.followed.base &&
            this.followed.hashAt(number) !== record.hash
        ) {
            this.log(
                "info",
                "A record does not join the blocks the mirror keeps; clearing the cache"
            );
            this.followed.clear();
        }
    }

    /** Applies the records from `from` on; an unplaceable or pruned answer clears the cache. */
    private async catchUp(from: bigint): Promise<void> {
        let answer: StorageDiffCatchUp;
        try {
            answer = await this.feed!.catchUp(
                [...this.tracked],
                from,
                this.serviceTimeoutMs()
            );
        } catch (error) {
            if (!(error instanceof StorageDiffPrunedError)) throw error;
            this.log(
                "info",
                "Mirror fell behind the service's retention; clearing the cache"
            );
            this.followed.clear();
            return;
        }
        for (const record of answer.records) {
            if (this.followed.hashAt(BigInt(record.number)) === record.hash)
                continue;
            if (!this.followed.attach(record)) {
                this.log(
                    "warn",
                    "Mirror cannot place a caught-up record; clearing the cache"
                );
                this.followed.clear();
                return;
            }
        }
    }

    private async onFeedLost(
        feed: StorageDiffSocket,
        reason: Error
    ): Promise<void> {
        if (this.feed !== feed) return;
        this.log("warn", "Storage diff service connection lost", {
            error: reason
        });
        // a read waiting for a snapshot holds the lock: it need not wait for one now
        this.snapshotWaits.releaseAwaited();
        await this.lock.lock();
        try {
            if (this.feed === feed) await this.disconnect();
        } finally {
            this.lock.unlock();
        }
    }

    /** Drops the socket and the cached state, which nothing feeds now. */
    private async disconnect(): Promise<void> {
        const feed = this.feed;
        this.feed = undefined;
        this.subscription = undefined;
        this.followed.clear();
        await feed?.destroy().catch(() => undefined);
    }
}
