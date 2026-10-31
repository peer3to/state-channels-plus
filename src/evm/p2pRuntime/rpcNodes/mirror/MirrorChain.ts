import { getReconnectDelayMs } from "../RpcNodeProvider";
import {
    StorageDiffNotRetainedError,
    StorageDiffPrunedError,
    type MirrorFeed,
    type MirrorFeedOpener
} from "./MirrorFeed";
import type { MirrorStateManager } from "./MirrorStateManager";
import { MirrorUnavailableError } from "./MirrorUnavailableError";
import type { Logger } from "@/utils/logging/Logger";
import { Mutex } from "@/utils/Mutex";
import {
    BACKSTOP_WINDOW_MS,
    LearnedBackstop,
    SDK_RPC_DEADLINE_MS
} from "@/utils/storageDiff/LearnedBackstop";
import type {
    AccountAddress,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    IncludedHeadRecord,
    StateRequestParams,
    StorageDiffCatchUp,
    StorageDiffDelayNotice,
    StorageDiffSnapshot,
    SubscribeResult,
    SubscriptionId
} from "@/utils/storageDiff/storageDiffWire";
import { toQuantity } from "ethers";

/**
 * Applied blocks kept with their `pre` values for a rollback. A reorg
 * deeper than this clears the cache instead.
 */
const MAX_APPLIED_BLOCKS = 128;
/**
 * The cap of the wait backstop: the deadline of the SDK's own RPCs, which
 * read through the mirror. It is one constant here because the provider is
 * built once per runtime host, before any channel exists, so the real value
 * (`NetworkRpcRouter.defaultRequestTimeoutMs`, from a channel's
 * `agreementTime`) cannot reach it without new architecture.
 */
export { SDK_RPC_DEADLINE_MS };

/**
 * Passes over one read the mirror makes before giving up on it: each pass
 * fills what the one before found missing.
 */
const MAX_DISCOVERY_PASSES = 256;
/** A block number above any head: a catch-up from it answers the head alone. */
const BEYOND_HEAD = 1n << 64n;

/** A block's height. */
type BlockNumber = bigint;

/** Milliseconds since the epoch. */
type EpochMs = number;

/** How the wait for an account's snapshot ended for that account. */
type SnapshotWaitEnd = "arrived" | "delayed" | "not-coming";

/** A block of the chain as the mirror follows it. */
type ChainBlock = { number: BlockNumber; hash: string };

/** A block of the chain as the mirror follows it. */
export type MirrorBlock = ChainBlock;

/** The mirror's head: the block its cached state is at. */
export type MirrorHead = ChainBlock;

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

export { MirrorUnavailableError };

/** What the mirror's own state reads cost, for measurement. */
export interface MirrorChainStatistics {
    /** Passes that had to ask for state the feed had not pushed. */
    lazyReads: number;
    /** Fields those passes asked for: slots, balances, nonces, codes. */
    lazyFields: number;
    /** Snapshots applied. */
    snapshots: number;
    /** Waits for a snapshot that ended at the backstop, a silent hang. */
    snapshotTimeouts: number;
    /** Waits for a snapshot the service said was delayed. */
    snapshotDelays: number;
    /** Reads sent to the node because the copy did not reach a block the peer saw by the backstop. */
    freshnessTimeouts: number;
    /** Reads sent to the node because the service said a block is late, or the node moved on. */
    behindNode: number;
    /** The longest a wait for a block lasts now when no event ends it. */
    backstopMs: number;
    /** The longest a wait for a snapshot lasts now when no event ends it. */
    snapshotBackstopMs: number;
    /** Accounts the feed said no snapshot is coming for. */
    lazyNotices: number;
    /** Accounts dropped to lazy reads after they were complete. */
    lazyDrops: number;
    /** Local answers re-asked of the node at the same block. */
    sampleChecks: number;
    /** Sampled answers the node answered differently. */
    sampleMismatches: number;
    /** Sampled answers the node could not be asked about, or declined. */
    sampleSkipped: number;
}

export type MirrorChainOptions = {
    /** `ws://` URL of the storage diff service. */
    openFeed: MirrorFeedOpener;
    state: MirrorStateManager;
    upstream: MirrorUpstream;
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
    private readonly openFeed: MirrorFeedOpener;
    private readonly state: MirrorStateManager;
    private readonly upstream: MirrorUpstream;
    private readonly logger: Logger;
    private readonly lock = new Mutex();
    /** Addresses the open subscription follows. */
    private readonly tracked = new Set<AccountAddress>();
    /** Each tracked address and the head its cached state began at. */
    private readonly trackedSince = new Map<AccountAddress, bigint>();
    /** Reads waiting for the head to move or the mirror to go down. */
    private readonly headWaiters = new Set<() => void>();
    private feed?: MirrorFeed;
    private subscription?: SubscriptionId;
    /** The block below `applied`; the head when nothing was applied yet. */
    private base?: ChainBlock;
    /** The environment of `base`. */
    private baseEnvironment?: BlockEnvironment;
    /** Blocks applied since `base`, oldest first. */
    private applied: BlockStorageDiff[] = [];
    private includedHeadRecord?: IncludedHeadRecord;
    /** Block of the peer's newest own transaction seen mined. */
    private requiredBlock?: ChainBlock;
    /** Newest block number the nodes announced; reads wait for the head to reach it. */
    private requiredNumber = 0n;
    /**
     * Accounts whose snapshot a fill is waiting for, and what ends the wait;
     * it is told whether the service said the snapshot is delayed.
     */
    private readonly awaitedSnapshots = new Map<
        AccountAddress,
        (end: SnapshotWaitEnd) => void
    >();
    /** When a node announced each block number the head has not reached yet. */
    private readonly announcedAt = new Map<BlockNumber, EpochMs>();
    /** How long a wait for a block lasts when no event ends it, learned from how long records took. */
    private readonly backstop = new LearnedBackstop(SDK_RPC_DEADLINE_MS);
    /**
     * How long a wait for a snapshot lasts when no event ends it, learned
     * from how long snapshots took: they come after a subscribe round trip,
     * which a block's record does not need.
     */
    private readonly snapshotBackstop = new LearnedBackstop(
        SDK_RPC_DEADLINE_MS
    );
    /** The block the service was last asked about at the start of a wait; reset when the head holds what the peer saw. */
    private probedNumber?: BlockNumber;
    /**
     * A wait ended without the block it waited for (the service said it is
     * late, the node moved on, or the backstop ran out): reads go to the node
     * until the head holds the block the peer saw.
     */
    private behind = false;
    /** Accounts whose missing state is read from the node: the feed's copy was found wrong. */
    private readonly nodeRead = new Set<AccountAddress>();
    /** Snapshots from a block the head has not reached, by arrival. */
    private pendingSnapshots: StorageDiffSnapshot[] = [];
    private readonly counters: Omit<
        MirrorChainStatistics,
        "backstopMs" | "snapshotBackstopMs"
    > = {
        lazyReads: 0,
        lazyFields: 0,
        snapshots: 0,
        snapshotTimeouts: 0,
        snapshotDelays: 0,
        freshnessTimeouts: 0,
        behindNode: 0,
        lazyNotices: 0,
        lazyDrops: 0,
        sampleChecks: 0,
        sampleMismatches: 0,
        sampleSkipped: 0
    };
    private failedAttempts = 0;
    private retryAfterMs = 0;
    private closed = false;

    constructor(options: MirrorChainOptions) {
        this.openFeed = options.openFeed;
        this.state = options.state;
        this.upstream = options.upstream;
        this.logger = options.logger.child({ component: "RpcMirror" });
    }

    /** The newest block the service reported as included, if any. */
    get includedHead(): IncludedHeadRecord | undefined {
        return this.includedHeadRecord;
    }

    /** The block the cached state is at, if the mirror is following. */
    get head(): MirrorHead | undefined {
        if (!this.base) return undefined;
        const newest = this.applied[this.applied.length - 1];
        return newest ? this.toBlock(newest) : this.base;
    }

    /**
     * A read issued from now on waits until the head reaches the block
     * `number` a node announced, so it never answers from before an event
     * the peer already saw.
     */
    requireNumber(number: bigint): void {
        if (number <= this.requiredNumber) return;
        // the node moved on while the mirror still lacks the block it announced
        // before: the service is a whole block behind, so reads go to the node
        const lacking = !this.holds(this.requiredBlock);
        this.requiredNumber = number;
        this.noteAnnounced(number);
        if (lacking) this.giveUpWaiting();
    }

    /** What the mirror's own state reads cost so far. */
    get statistics(): MirrorChainStatistics {
        return {
            ...this.counters,
            backstopMs: this.backstop.boundMs,
            snapshotBackstopMs: this.snapshotBackstop.boundMs
        };
    }

    /** The newest block number a node announced to this runtime. */
    get announcedNumber(): bigint {
        return this.requiredNumber;
    }

    /**
     * Asks the service something that needs none of the cached state: no
     * lock, no wait. The mirror opens the service connection first if it is
     * not open.
     */
    async queryService<T>(ask: (feed: MirrorFeed) => Promise<T>): Promise<T> {
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
            this.counters.lazyDrops++;
        } finally {
            this.lock.unlock();
        }
    }

    /** Counts one sampled answer: checked and matching, mismatching, or skipped. */
    noteSample(outcome: "match" | "mismatch" | "skipped"): void {
        if (outcome === "skipped") this.counters.sampleSkipped++;
        else {
            this.counters.sampleChecks++;
            if (outcome === "mismatch") this.counters.sampleMismatches++;
        }
    }

    /** The block number a service read names as the one its caller saw, if any. */
    get seenBlock(): string | undefined {
        return this.requiredNumber > 0n
            ? "0x" + this.requiredNumber.toString(16)
            : undefined;
    }

    /** A read issued from now on waits until the mirror applied `block`. */
    requireBlock(block: ChainBlock): void {
        if (!this.requiredBlock || block.number >= this.requiredBlock.number)
            this.requiredBlock = block;
        this.noteAnnounced(block.number);
    }

    /**
     * Runs `read` with the state at the head. State the read finds missing
     * is read from the service in one request, tracking the new addresses
     * first, and the read runs again from the start, so one read sees one head.
     */
    async run<T>(read: (head: MirrorHead) => Promise<T>): Promise<T> {
        await this.waitForRequiredBlock();
        await this.lock.lock();
        try {
            for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
                const head = await this.ensureFollowing();
                // following again may have started from a service that is behind the peer
                if (!this.holds(this.requiredBlock))
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
        const environment =
            this.applied[this.applied.length - 1] ?? this.baseEnvironment;
        if (!environment)
            throw new MirrorUnavailableError("Mirror is not following");
        return environment;
    }

    async close(): Promise<void> {
        this.closed = true;
        this.notifyHeadWaiters();
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

    private toBlock(record: BlockStorageDiff): ChainBlock {
        return { number: BigInt(record.number), hash: record.hash };
    }

    /**
     * Waits until the mirror holds the block the peer saw. The wait ends at
     * the first of: the block's record arriving (it then returns); the
     * service saying the block is late, or the node announcing a later block
     * while this one is still missing ({@link giveUpWaiting}); the connection
     * dropping (the mirror then does not follow, and the read starts over
     * from the service's head); and, for a service that hangs silently, the
     * learned backstop. A wait that ends without the block throws, so the
     * read goes to the node and never to an older head.
     */
    private async waitForRequiredBlock(): Promise<void> {
        const deadline = Date.now() + this.backstop.boundMs;
        for (;;) {
            if (this.closed || this.holds(this.requiredBlock)) {
                this.behind = false;
                this.probedNumber = undefined;
                return;
            }
            if (this.behind) {
                this.counters.behindNode++;
                throw new MirrorUnavailableError(
                    "The mirror is behind the node"
                );
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                this.behind = true;
                this.counters.freshnessTimeouts++;
                throw new MirrorUnavailableError(
                    "The block never reached the mirror"
                );
            }
            this.probeService();
            await new Promise<void>((resolve) => {
                const wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(wake, remaining);
                this.headWaiters.add(wake);
            });
        }
    }

    /**
     * Asks the service for its head at the block the wait is for, once per
     * wait: a service whose upstream has not seen the block answers with an
     * `upstream-behind` notice at once, which ends the wait; its answer, the
     * head having reached the block, is no end of its own, the wait ends when
     * the record is applied. A failed probe leaves the wait to its events.
     */
    private probeService(): void {
        const wanted = this.wantedNumber();
        if (!this.feed || this.probedNumber === wanted) return;
        this.probedNumber = wanted;
        this.feed.fetchHead(toQuantity(wanted)).catch((error) => {
            this.log("debug", "Storage diff service head probe failed", {
                error
            });
        });
    }

    /** The newest block number a wait for the head is for. */
    private wantedNumber(): BlockNumber {
        return this.requiredBlock
            ? this.requiredBlock.number > this.requiredNumber
                ? this.requiredBlock.number
                : this.requiredNumber
            : this.requiredNumber;
    }

    /** Ends the waits for a block the head lacks: those reads go to the node. */
    private giveUpWaiting(): void {
        this.behind = true;
        this.notifyHeadWaiters();
    }

    /** Notes when a node announced `number`, to time how long its record takes. */
    private noteAnnounced(number: BlockNumber): void {
        const head = this.head;
        // not following, or already at the block: no wait to time
        if (!head || head.number >= number || this.announcedAt.has(number))
            return;
        this.announcedAt.set(number, Date.now());
    }

    /** Records how long the announced blocks up to `number` took to reach the head. */
    private noteArrived(number: BlockNumber): void {
        const now = Date.now();
        for (const [announced, at] of this.announcedAt) {
            // a block never applied (orphaned) does not teach how long one takes
            if (now - at > BACKSTOP_WINDOW_MS)
                this.announcedAt.delete(announced);
            else if (announced <= number) {
                this.backstop.record(now - at);
                this.announcedAt.delete(announced);
            }
        }
    }

    /**
     * Whether the mirror's state includes `block`. Not following counts as
     * including it: the read then starts from the service's best head.
     */
    private holds(block: ChainBlock | undefined): boolean {
        if (!this.base || !this.head) return true;
        if (this.head.number < this.requiredNumber) return false;
        if (!block) return true;
        return (
            block.number < this.base.number ||
            this.hashAt(block.number) === block.hash
        );
    }

    private notifyHeadWaiters(): void {
        for (const waiter of [...this.headWaiters]) waiter();
        this.headWaiters.clear();
    }

    private async ensureFollowing(): Promise<MirrorHead> {
        if (this.closed) throw new MirrorUnavailableError("Mirror closed");
        if (this.feed && this.base) return this.head!;
        if (Date.now() < this.retryAfterMs)
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        try {
            if (!this.feed) await this.connect();
            if (!this.base) await this.startFromServiceHead();
            const head = this.head;
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
        const feed: MirrorFeed = this.openFeed({
            onRecord: (subscription, record) => {
                if (subscription === this.subscription && !this.closed)
                    void this.applyPushed(record);
            },
            // A snapshot comes under the id of the subscribe that added its
            // accounts, which is not always the one records come under.
            onSnapshot: (_subscription, snapshot) => {
                if (!this.closed) this.receiveSnapshot(snapshot);
            },
            onIncludedHead: (head) => this.noteIncludedHead(head),
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
        if (answer.includedHead) this.noteIncludedHead(answer.includedHead);
        const head = answer.head;
        this.base = { number: BigInt(head.number), hash: head.hash };
        this.baseEnvironment = head;
        this.applied = [];
        for (const address of this.tracked)
            this.trackedSince.set(address, this.base.number);
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
            const snapshots = this.expectSnapshots(added);
            const statuses = await this.track(added);
            // only a snapshot the feed has ready is waited for; a syncing
            // account is read lazily now and takes its snapshot when it comes
            snapshots.release(
                added.filter((address) => statuses[address] !== "ready")
            );
            await snapshots.settled();
            // following may have cleared the cache; the pass then starts over
            const head = this.head;
            if (!head) return;
            const lacking = this.state.stillMissing(misses);
            if (lacking.length === 0) return;
            this.counters.lazyReads++;
            this.counters.lazyFields += lacking.reduce(
                (sum, miss) =>
                    sum +
                    (miss.slots?.length ?? 0) +
                    (miss.account ? 2 : 0) +
                    (miss.code ? 1 : 0),
                0
            );
            this.log("debug", "Mirror reads state the feed did not push", {
                accounts: lacking.map((miss) => miss.address),
                fields: this.counters.lazyFields
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
     * Starts expecting the snapshots of `addresses`, before following them,
     * so one that arrives during that is applied at once. `settled` waits for
     * all of them; it ends at the first of: they all arrive, the service says
     * they are not coming (`lazy`: the read goes on and reads them as it
     * needs; delayed: the read throws and goes to the node), the connection
     * drops, or the learned backstop runs out (the read throws).
     */
    private expectSnapshots(addresses: AccountAddress[]): {
        release: (addresses: AccountAddress[]) => void;
        settled: () => Promise<void>;
    } {
        const waiting = addresses.filter(
            (address) => !this.state.isComplete(address)
        );
        // from here the subscribe and the snapshot's arrival are timed together
        const startedAt = Date.now();
        let remaining = waiting.length;
        let delayed = false;
        let resolveAll!: () => void;
        const all = new Promise<void>((resolve) => (resolveAll = resolve));
        if (remaining === 0) resolveAll();
        for (const address of waiting)
            this.awaitedSnapshots.set(address, (end) => {
                if (end === "delayed") delayed = true;
                if (end === "arrived")
                    this.snapshotBackstop.record(Date.now() - startedAt);
                if (--remaining === 0) resolveAll();
            });
        return {
            release: (released) => {
                for (const address of released) {
                    const done = this.awaitedSnapshots.get(address);
                    this.awaitedSnapshots.delete(address);
                    done?.("not-coming");
                }
            },
            settled: async () => {
                if (remaining === 0) return;
                let timer: ReturnType<typeof setTimeout> | undefined;
                let expiredAtBackstop = false;
                const expired = new Promise<void>((resolve) => {
                    timer = setTimeout(() => {
                        expiredAtBackstop = true;
                        resolve();
                    }, this.snapshotBackstop.boundMs);
                });
                await Promise.race([all, expired]);
                clearTimeout(timer);
                for (const address of waiting)
                    this.awaitedSnapshots.delete(address);
                // a snapshot that did not come sends the read to the node
                if (expiredAtBackstop) {
                    this.counters.snapshotTimeouts++;
                    throw new MirrorUnavailableError(
                        "The snapshot never reached the mirror"
                    );
                }
                if (delayed) {
                    this.counters.snapshotDelays++;
                    throw new MirrorUnavailableError(
                        "The service said the snapshot is delayed"
                    );
                }
            }
        };
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
                this.awaitedSnapshots.get(address)?.("delayed");
            return;
        }
        if (this.holds(this.requiredBlock)) return;
        const wanted = this.wantedNumber();
        if (
            notice.reason === "upstream-behind" &&
            wanted < BigInt(notice.requested)
        )
            return;
        this.giveUpWaiting();
    }

    /**
     * A snapshot from the feed. While a read waits for it, it is applied at
     * once, catching the head up to its block first; otherwise it waits its
     * turn behind the reads and records in hand.
     */
    private receiveSnapshot(snapshot: StorageDiffSnapshot): void {
        // no snapshot is coming for these: stop waiting, the reads fetch them
        for (const address of snapshot.lazy ?? []) {
            this.counters.lazyNotices++;
            const done = this.awaitedSnapshots.get(address);
            this.awaitedSnapshots.delete(address);
            done?.("not-coming");
            // the feed found the complete state it pushed before to be short
            if (this.state.isComplete(address))
                void this.dropToLazy(address, false);
        }
        if (Object.keys(snapshot.accounts).length === 0) return;
        const awaited = Object.keys(snapshot.accounts).some((address) =>
            this.awaitedSnapshots.has(address)
        );
        void (awaited
            ? this.applyAwaited(snapshot)
            : this.applyQueued(snapshot));
    }

    private async applyAwaited(snapshot: StorageDiffSnapshot): Promise<void> {
        try {
            if (!this.base) return;
            while (BigInt(snapshot.block.number) > this.head!.number) {
                const before = this.head!.number;
                await this.catchUp(before + 1n);
                if (!this.base || this.head!.number === before) break;
            }
            this.placeSnapshot(snapshot);
        } catch (error) {
            this.log("warn", "Mirror cannot apply a snapshot", { error });
        }
    }

    private async applyQueued(snapshot: StorageDiffSnapshot): Promise<void> {
        await this.lock.lock();
        try {
            if (!this.base || this.closed) return;
            this.placeSnapshot(snapshot);
        } catch (error) {
            this.log("warn", "Mirror cannot apply a snapshot", { error });
        } finally {
            this.lock.unlock();
        }
    }

    /**
     * Makes the snapshot's accounts what it says, then replays the applied
     * blocks after it for them. A snapshot of a block the head has not
     * reached waits for the head; one of a block that is not on the chain the
     * mirror follows is dropped, and the accounts are read as needed.
     */
    private placeSnapshot(snapshot: StorageDiffSnapshot): void {
        const number = BigInt(snapshot.block.number);
        if (number > this.head!.number) {
            this.pendingSnapshots.push(snapshot);
            return;
        }
        if (this.hashAt(number) !== snapshot.block.hash) return;
        const addresses = Object.keys(snapshot.accounts);
        this.state.applySnapshot(snapshot.accounts);
        for (const record of this.applied)
            if (BigInt(record.number) > number)
                this.state.replay(record, addresses);
        for (const address of addresses) {
            this.trackedSince.set(address, number);
            const done = this.awaitedSnapshots.get(address);
            this.awaitedSnapshots.delete(address);
            done?.("arrived");
        }
        this.counters.snapshots++;
    }

    private async readFromNode(
        block: bigint,
        misses: StateRequestParams[]
    ): Promise<AccountDiffs> {
        const accounts: AccountDiffs = {};
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
                        this.upstream.getBalance(address, block).then((v) => {
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
        return accounts;
    }

    /** Follows `addresses` too: one subscription for the whole set, then a catch-up. */
    private async track(
        addresses: AccountAddress[]
    ): Promise<SubscribeResult["accounts"]> {
        if (addresses.length === 0) return {};
        const head = this.head;
        const feed = this.feed;
        if (!head || !feed)
            throw new MirrorUnavailableError("Mirror is not following");
        const previous = this.subscription;
        const subscribed = await feed.subscribe([
            ...this.tracked,
            ...addresses
        ]);
        this.subscription = subscribed.subscription;
        for (const address of addresses) {
            this.tracked.add(address);
            this.trackedSince.set(address, head.number);
        }
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

    private noteIncludedHead(head: IncludedHeadRecord): void {
        const current = this.includedHeadRecord;
        if (!current || BigInt(head.number) > BigInt(current.number))
            this.includedHeadRecord = head;
    }

    /** Applies a pushed record once every earlier read and record is done. */
    private async applyPushed(record: BlockStorageDiff): Promise<void> {
        await this.lock.lock();
        try {
            if (!this.base || this.closed) return;
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
        const head = this.head!;
        const number = BigInt(record.number);
        // below what the mirror keeps: neither a duplicate nor placeable
        if (number < this.base!.number) return;
        if (this.hashAt(number) === record.hash) return;
        if (this.attach(record)) return;
        // the parent is not a block the mirror holds: a gap, or a branch
        // that starts below what it kept
        await this.catchUp(
            number > head.number + 1n
                ? head.number + 1n
                : this.base!.number + 1n
        );
    }

    /**
     * Applies `record` on its parent: the head, or an earlier block the
     * mirror rolls back to. False when the parent is not a block it holds.
     */
    private attach(record: BlockStorageDiff): boolean {
        const parent = BigInt(record.number) - 1n;
        const holdsParent = this.hashAt(parent) === record.parentHash;
        if (!holdsParent) return false;
        while (this.head!.number > parent) this.rollBack();
        this.applyBlock(record);
        return true;
    }

    private hashAt(number: bigint): string | undefined {
        if (this.base!.number === number) return this.base!.hash;
        const record = this.applied[Number(number - this.base!.number) - 1];
        return record && BigInt(record.number) === number
            ? record.hash
            : undefined;
    }

    private applyBlock(record: BlockStorageDiff): void {
        this.state.applyBlock(record);
        this.applied.push(record);
        this.noteArrived(BigInt(record.number));
        if (this.pendingSnapshots.length > 0) {
            const waiting = this.pendingSnapshots;
            this.pendingSnapshots = [];
            for (const snapshot of waiting) this.placeSnapshot(snapshot);
        }
        while (this.applied.length > MAX_APPLIED_BLOCKS) {
            const oldest = this.applied.shift()!;
            this.base = this.toBlock(oldest);
            this.baseEnvironment = oldest;
        }
        this.notifyHeadWaiters();
    }

    private rollBack(): void {
        const record = this.applied.pop();
        if (!record) throw new Error("Cannot roll back below the first block");
        this.state.revertBlock(record);
        // a block rolled back is no longer the chain's: nothing to wait for
        if (this.requiredBlock?.hash === record.hash)
            this.requiredBlock = undefined;
        const number = BigInt(record.number);
        // an address followed from this block on has no diff to undo it
        for (const [address, since] of this.trackedSince) {
            if (since >= number) {
                this.state.forget(address);
                this.trackedSince.set(address, number - 1n);
            }
        }
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
            this.clear();
            return;
        }
        if (answer.includedHead) this.noteIncludedHead(answer.includedHead);
        for (const record of answer.records) {
            if (this.hashAt(BigInt(record.number)) === record.hash) continue;
            if (!this.attach(record)) {
                this.log(
                    "warn",
                    "Mirror cannot place a caught-up record; clearing the cache"
                );
                this.clear();
                return;
            }
        }
    }

    /** Forgets all cached state; the next read starts from the service's best head. */
    private clear(): void {
        this.state.clearCaches();
        this.base = undefined;
        this.baseEnvironment = undefined;
        this.applied = [];
        this.trackedSince.clear();
        this.pendingSnapshots = [];
        this.notifyHeadWaiters();
    }

    private async onFeedLost(feed: MirrorFeed, reason: Error): Promise<void> {
        if (this.feed !== feed) return;
        this.log("warn", "Storage diff service connection lost", {
            error: reason
        });
        // a read waiting for a snapshot holds the lock: it need not wait for one now
        this.releaseAwaited();
        await this.lock.lock();
        try {
            if (this.feed === feed) await this.disconnect();
        } finally {
            this.lock.unlock();
        }
    }

    /** Ends every wait for a snapshot. */
    private releaseAwaited(): void {
        for (const done of [...this.awaitedSnapshots.values()])
            done("not-coming");
        this.awaitedSnapshots.clear();
    }

    /** Drops the socket and the cached state, which nothing feeds now. */
    private async disconnect(): Promise<void> {
        const feed = this.feed;
        this.feed = undefined;
        this.subscription = undefined;
        this.clear();
        await feed?.destroy().catch(() => undefined);
    }
}
