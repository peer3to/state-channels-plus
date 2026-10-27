import { getReconnectDelayMs } from "../RpcNodeProvider";
import {
    UntrackedAddressError,
    type MirrorStateManager,
    type MirrorUpstream
} from "./MirrorStateManager";
import {
    StorageDiffPrunedError,
    StorageDiffSocket,
    type StorageDiffCatchUp
} from "./StorageDiffSocket";
import type { Logger } from "@/utils/logging/Logger";
import { Mutex } from "@/utils/Mutex";
import type {
    AccountAddress,
    BlockStorageDiff,
    IncludedHeadRecord,
    SubscriptionId
} from "@/utils/node/storageDiff/blockStorageDiff";

/**
 * Applied blocks kept with their `pre` values for a rollback. A reorg
 * deeper than this clears the cache instead.
 */
const MAX_APPLIED_BLOCKS = 128;
/**
 * Longest a read waits for the mirror to reach a block of the peer's own
 * transaction before it goes to the RPC node.
 */
const OWN_TRANSACTION_WAIT_MS = 10_000;

/** The parts of an upstream block header a call's block environment needs. */
export type MirrorHeader = {
    timestamp: bigint;
    gasLimit: bigint;
    baseFeePerGas?: bigint;
    miner: string;
};

/** A block of the chain as the mirror follows it. */
type ChainBlock = { number: bigint; hash: string };

/** A block of the chain as the mirror follows it. */
export type MirrorBlock = ChainBlock;

/** The mirror's head: the block its cached state is at. */
export type MirrorHead = ChainBlock;

/** What the mirror asks the RPC node besides state reads. */
export interface MirrorChainUpstream extends MirrorUpstream {
    /** The node's header at `latest`, or at the block with `hash`. */
    getHeader(
        block: "latest" | { hash: string }
    ): Promise<(ChainBlock & { header: MirrorHeader }) | null>;
}

/** The mirror cannot answer now; the request goes to the RPC node. */
export class MirrorUnavailableError extends Error {}

export type MirrorChainOptions = {
    /** `ws://` URL of the storage diff service. */
    serviceUrl: string;
    state: MirrorStateManager;
    upstream: MirrorChainUpstream;
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
    private readonly upstream: MirrorChainUpstream;
    private readonly logger: Logger;
    private readonly lock = new Mutex();
    /** Addresses the open subscription follows. */
    private readonly tracked = new Set<AccountAddress>();
    /** Each tracked address and the head its cached state began at. */
    private readonly trackedSince = new Map<AccountAddress, bigint>();
    /** Reads waiting for the head to move or the mirror to go down. */
    private readonly headWaiters = new Set<() => void>();
    private socket?: StorageDiffSocket;
    private subscription?: SubscriptionId;
    /** The block below `applied`; the head when nothing was applied yet. */
    private base?: ChainBlock;
    /** Blocks applied since `base`, oldest first. */
    private applied: BlockStorageDiff[] = [];
    private headers = new Map<string, MirrorHeader>();
    private includedHeadRecord?: IncludedHeadRecord;
    /** Block of the peer's newest own transaction seen mined. */
    private requiredBlock?: ChainBlock;
    private failedAttempts = 0;
    private retryAfterMs = 0;
    private closed = false;

    constructor(options: MirrorChainOptions) {
        this.serviceUrl = options.serviceUrl;
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

    isTracked(address: AccountAddress): boolean {
        return this.tracked.has(address);
    }

    /** A read issued from now on waits until the mirror applied `block`. */
    requireBlock(block: ChainBlock): void {
        if (!this.requiredBlock || block.number >= this.requiredBlock.number)
            this.requiredBlock = block;
    }

    /**
     * Runs `read` with the state at the head. A read that touches an address
     * the service does not follow yet is stopped, the address tracked, and
     * the read run again from the start, so one read sees one head.
     */
    async run<T>(read: (head: MirrorHead) => Promise<T>): Promise<T> {
        await this.waitForOwnTransactions();
        await this.lock.lock();
        try {
            for (;;) {
                const head = await this.ensureFollowing();
                try {
                    return await read(head);
                } catch (error) {
                    if (!(error instanceof UntrackedAddressError)) throw error;
                    await this.track(error.address);
                }
            }
        } finally {
            this.lock.unlock();
        }
    }

    /** The header of the head block. */
    async headHeader(head: MirrorHead): Promise<MirrorHeader> {
        const cached = this.headers.get(head.hash);
        if (cached) return cached;
        const found = await this.upstream.getHeader({ hash: head.hash });
        if (!found)
            throw new MirrorUnavailableError("Head block unknown upstream");
        this.headers = new Map([[head.hash, found.header]]);
        return found.header;
    }

    async close(): Promise<void> {
        this.closed = true;
        this.notifyHeadWaiters();
        const socket = this.socket;
        this.socket = undefined;
        await socket?.destroy();
    }

    // Nothing is logged once closed: the owner's logger may be disposed first.
    private log(
        level: "warn" | "info",
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

    private async waitForOwnTransactions(): Promise<void> {
        const deadline = Date.now() + OWN_TRANSACTION_WAIT_MS;
        for (;;) {
            const required = this.requiredBlock;
            if (this.closed || !required || this.holds(required)) return;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                // the block never reached the mirror: stop holding reads for it
                if (this.requiredBlock === required)
                    this.requiredBlock = undefined;
                return;
            }
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
     * Whether the mirror's state includes `block`. Not following counts as
     * including it: the read then starts from the node's latest block.
     */
    private holds(block: ChainBlock): boolean {
        if (!this.base) return true;
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
        if (this.socket && this.base) return this.head!;
        if (Date.now() < this.retryAfterMs)
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        try {
            if (!this.socket) await this.connect();
            if (!this.base) await this.startFromLatest();
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
        const socket = new StorageDiffSocket(this.serviceUrl, {
            onRecord: (subscription, record) => {
                if (subscription === this.subscription && !this.closed)
                    void this.applyPushed(record);
            },
            onIncludedHead: (head) => this.noteIncludedHead(head),
            onLost: (reason) => void this.onSocketLost(socket, reason)
        });
        this.socket = socket;
        this.subscription = await socket.subscribe([...this.tracked]);
    }

    /** Takes the node's latest block as the head and catches up from it. */
    private async startFromLatest(): Promise<void> {
        const latest = await this.upstream.getHeader("latest");
        if (!latest) throw new Error("The node has no latest block");
        this.base = { number: latest.number, hash: latest.hash };
        this.applied = [];
        this.headers = new Map([[latest.hash, latest.header]]);
        this.state.setBlockTag(latest.number);
        for (const address of this.tracked)
            this.trackedSince.set(address, latest.number);
        await this.catchUp(latest.number + 1n);
    }

    private async track(address: AccountAddress): Promise<void> {
        const head = this.head;
        const socket = this.socket;
        if (!head || !socket)
            throw new MirrorUnavailableError("Mirror is not following");
        try {
            const previous = this.subscription;
            this.subscription = await socket.subscribe([
                ...this.tracked,
                address
            ]);
            this.tracked.add(address);
            this.trackedSince.set(address, head.number);
            if (previous) await socket.unsubscribe(previous);
            await this.catchUp(head.number + 1n);
        } catch (error) {
            if (error instanceof MirrorUnavailableError) throw error;
            this.log("warn", "Mirror cannot track an address", { error });
            await this.disconnect();
            throw new MirrorUnavailableError(
                "Storage diff service unavailable"
            );
        }
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
        while (this.applied.length > MAX_APPLIED_BLOCKS) {
            const oldest = this.applied.shift()!;
            this.base = this.toBlock(oldest);
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
            answer = await this.socket!.catchUp([...this.tracked], from);
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

    /** Forgets all cached state; the next read starts from the node's latest block. */
    private clear(): void {
        this.state.clearCaches();
        this.base = undefined;
        this.applied = [];
        this.trackedSince.clear();
        this.notifyHeadWaiters();
    }

    private async onSocketLost(
        socket: StorageDiffSocket,
        reason: Error
    ): Promise<void> {
        if (this.socket !== socket) return;
        this.log("warn", "Storage diff service connection lost", {
            error: reason
        });
        await this.lock.lock();
        try {
            if (this.socket === socket) await this.disconnect();
        } finally {
            this.lock.unlock();
        }
    }

    /** Drops the socket and the cached state, which nothing feeds now. */
    private async disconnect(): Promise<void> {
        const socket = this.socket;
        this.socket = undefined;
        this.subscription = undefined;
        this.clear();
        await socket?.destroy().catch(() => undefined);
    }
}
