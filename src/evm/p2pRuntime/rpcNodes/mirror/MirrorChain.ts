import { getReconnectDelayMs } from "../RpcNodeProvider";
import { FollowedChain, type MirrorBlock } from "./FollowedChain";
import { HeadFreshness } from "./HeadFreshness";
import type { MirrorStateManager } from "./MirrorStateManager";
import { MirrorUnavailableError } from "./MirrorUnavailableError";
import { SnapshotWaits } from "./SnapshotWaits";
import {
    StorageDiffNotRetainedError,
    StorageDiffPrunedError,
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
 * What the mirror reads from the RPC node when the service does not retain
 * the head block (answers -32002), at that block's number.
 */
export interface MirrorUpstream {
    getStorageAt(
        address: AccountAddress,
        slot: string,
        block: bigint
    ): Promise<string>;
    getBalance(address: AccountAddress, block: bigint): Promise<string>;
    getTransactionCount(
        address: AccountAddress,
        block: bigint
    ): Promise<string>;
    getCode(address: AccountAddress, block: bigint): Promise<string>;
}

export type MirrorChainOptions = {
    /** `ws://` URL of the storage diff service. */
    serviceUrl: string;
    state: MirrorStateManager;
    upstream: MirrorUpstream;
    /** How long the nodes took lately to answer; the waits leave room for it. */
    nodeRoundTrips?: RecentSlowest;
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
    private readonly upstream: MirrorUpstream;
    private readonly logger: Logger;
    /** How long the nodes took lately to answer what the provider forwarded. */
    private readonly nodeRoundTrips: RecentSlowest;
    private readonly lock = new Mutex();
    /** Addresses the open subscription follows. */
    private readonly tracked = new Set<AccountAddress>();
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
    private failedAttempts = 0;
    private retryAfterMs = 0;
    private closed = false;

    constructor(options: MirrorChainOptions) {
        this.serviceUrl = options.serviceUrl;
        this.state = options.state;
        this.upstream = options.upstream;
        this.nodeRoundTrips = options.nodeRoundTrips ?? new RecentSlowest();
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
                this.snapshotWaits.end(address, "arrived")
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

    /** The block the cached state is at, if the mirror is following. */
    get head(): MirrorBlock | undefined {
        return this.followed.head;
    }

    /**
     * A read issued from now on waits until the head reaches the block
     * `number` a node announced, so it never answers from before an event
     * the peer already saw.
     */
    requireNumber(number: bigint): void {
        this.freshness.requireNumber(number);
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

    /** The newest block number a node announced to this runtime. */
    get announcedNumber(): bigint {
        return this.freshness.announcedNumber;
    }

    /**
     * Asks the service something that needs none of the cached state: no
     * lock, no wait. The mirror opens the service connection first if it is
     * not open.
     */
    async queryService<T>(
        ask: (feed: StorageDiffSocket) => Promise<T>
    ): Promise<T> {
        if (!this.feed) {
            await this.lock.lock();
            try {
                await this.ensureFollowing();
            } finally {
                this.lock.unlock();
            }
        }
        const feed = this.feed;
        if (!feed) throw new MirrorUnavailableError("Mirror is not following");
        try {
            return await ask(feed);
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
     */
    async run<T>(read: (head: MirrorBlock) => Promise<T>): Promise<T> {
        await this.freshness.waitForRequiredBlock();
        await this.lock.lock();
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
                if (misses.length === 0) {
                    if ("error" in outcome) throw outcome.error;
                    return outcome.value;
                }
                // the pass ran on placeholders: its outcome is discarded
                await this.fillMisses(misses);
            }
            throw new MirrorUnavailableError(
                "The read keeps finding state missing"
            );
        } finally {
            this.lock.unlock();
        }
    }

    /** The environment of the head block. */
    headEnvironment(): BlockEnvironment {
        return this.followed.headEnvironment();
    }

    async close(): Promise<void> {
        this.closed = true;
        this.freshness.notifyHeadWaiters();
        const feed = this.feed;
        this.feed = undefined;
        await feed?.destroy();
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
            await feed.subscribe([...this.tracked])
        ).subscription;
    }

    /** Takes the service's best head as the head. */
    private async startFromServiceHead(): Promise<void> {
        const answer = await this.feed!.catchUp([...this.tracked], BEYOND_HEAD);
        const head = answer.head;
        this.followed.begin(head, this.tracked);
    }

    /**
     * Reads what a pass found missing from the service at the head block,
     * after following the addresses it touched; the node answers only when
     * the service does not retain that block.
     */
    private async fillMisses(misses: StateRequestParams[]): Promise<void> {
        try {
            const added = misses
                .map((miss) => miss.address)
                .filter((address) => !this.tracked.has(address));
            // registered before following, so a snapshot that comes during it is applied at once
            const snapshots = this.snapshotWaits.expectSnapshots(added);
            const statuses = await this.track(added);
            // only a snapshot the feed has ready is waited for; a syncing
            // account is read lazily now and takes its snapshot when it comes
            snapshots.release(
                added.filter((address) => statuses[address] !== "ready")
            );
            await snapshots.settled();
            // following may have cleared the cache; the pass then starts over
            const head = this.followed.head;
            if (!head) return;
            const lacking = this.state.stillMissing(misses);
            if (lacking.length === 0) return;
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
                this.state.fill(await this.readFromNode(head.number, fromNode));
            if (fromFeed.length === 0) return;
            try {
                const state = await this.feed!.getState(head.hash, fromFeed);
                this.state.fill(state.accounts);
            } catch (error) {
                if (!(error instanceof StorageDiffNotRetainedError))
                    throw error;
                this.state.fill(await this.readFromNode(head.number, fromFeed));
            }
        } catch (error) {
            if (error instanceof MirrorUnavailableError) throw error;
            this.log("warn", "Mirror cannot read state", { error });
            await this.disconnect();
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
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
        void (awaited
            ? this.applyAwaited(snapshot)
            : this.applyQueued(snapshot));
    }

    private async applyAwaited(snapshot: StorageDiffSnapshot): Promise<void> {
        try {
            if (!this.followed.base) return;
            while (BigInt(snapshot.block.number) > this.followed.head!.number) {
                const before = this.followed.head!.number;
                await this.catchUp(before + 1n);
                if (
                    !this.followed.base ||
                    this.followed.head!.number === before
                )
                    break;
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
        block: bigint,
        misses: StateRequestParams[]
    ): Promise<AccountDiffs> {
        const accounts: AccountDiffs = {};
        try {
            await Promise.all(
                misses.map(async ({ address, slots, account, code }) => {
                    const read = (accounts[address] ??= {});
                    await Promise.all([
                        ...(slots ?? []).map(async (slot) => {
                            (read.storage ??= {})[slot] =
                                await this.upstream.getStorageAt(
                                    address,
                                    slot,
                                    block
                                );
                        }),
                        account &&
                            this.upstream
                                .getBalance(address, block)
                                .then((v) => {
                                    read.balance = v;
                                }),
                        account &&
                            this.upstream
                                .getTransactionCount(address, block)
                                .then((v) => {
                                    read.nonce = Number(BigInt(v));
                                }),
                        code &&
                            this.upstream.getCode(address, block).then((v) => {
                                read.code = v;
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
        const subscribed = await feed.subscribe([
            ...this.tracked,
            ...addresses
        ]);
        this.subscription = subscribed.subscription;
        for (const address of addresses) this.tracked.add(address);
        this.followed.trackFrom(addresses, head.number);
        // the service keeping a superseded subscription costs only pushes the
        // new one also carries, so a failed unsubscribe keeps the connection
        if (previous)
            await feed.unsubscribe(previous).catch((error) => {
                this.log(
                    "warn",
                    "Mirror cannot drop its previous subscription",
                    {
                        error
                    }
                );
            });
        await this.catchUp(head.number + 1n);
        return subscribed.accounts;
    }

    /** Applies a pushed record once every earlier read and record is done. */
    private async applyPushed(record: BlockStorageDiff): Promise<void> {
        await this.lock.lock();
        try {
            if (!this.followed.base || this.closed) return;
            await this.apply(record);
        } catch (error) {
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
        // below what the mirror keeps: neither a duplicate nor placeable
        if (number < this.followed.base!.number) return;
        if (this.followed.hashAt(number) === record.hash) return;
        if (this.followed.attach(record)) return;
        // the parent is not a block the mirror holds: a gap, or a branch
        // that starts below what it kept
        await this.catchUp(
            number > head.number + 1n
                ? head.number + 1n
                : this.followed.base!.number + 1n
        );
    }

    /** Applies the records from `from` on; an unplaceable or pruned answer clears the cache. */
    private async catchUp(from: bigint): Promise<void> {
        let answer: StorageDiffCatchUp;
        try {
            answer = await this.feed!.catchUp([...this.tracked], from);
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
