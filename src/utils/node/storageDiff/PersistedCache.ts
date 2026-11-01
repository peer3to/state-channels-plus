import type {
    AccountAddress,
    AccountDiffs,
    BlockHeader,
    StagedBlock
} from "./blockStorageDiff";
import type { StateCache } from "./StateCache";
import type { PersistedBlock, PersistedState, StateStore } from "./StateStore";
import type { Logger } from "@/utils";

/** Quiet time before the cache is written to disk, so a burst of blocks is one write. */
const SAVE_DEBOUNCE_MS = 500;
/** Newest blocks the file keeps, to undo them if the saved head is orphaned. */
const PERSISTED_BLOCKS = 64;

/** What a persisted cache uses of the service that owns the cache and the history. */
export interface PersistedCacheOptions {
    store: StateStore;
    stateCache: StateCache;
    /** Accounts the service keeps the values of in every record it stages. */
    watched: Map<AccountAddress, Promise<void>>;
    logger: Logger;
    /** Aborted when the service stops. */
    stopping: AbortSignal;
    /** The canonical history, oldest first; it is replaced as the service loads it. */
    canonical: () => StagedBlock[];
    failureReason: (error: unknown) => string;
    retainedIndex: (blockHash: string) => number;
    fetchHeader: (by: "latest" | bigint | string) => Promise<BlockHeader>;
    stage: (
        headers: BlockHeader[],
        preFrom: "cache" | "chain"
    ) => Promise<StagedBlock[]>;
}

/**
 * The state cache kept on disk: written after a quiet time, loaded before the
 * history is staged, and brought to the best head once it is.
 */
export class PersistedCache {
    private readonly store: StateStore;
    private readonly stateCache: StateCache;
    private readonly watched: Map<AccountAddress, Promise<void>>;
    private readonly logger: Logger;
    private readonly stopping: AbortSignal;
    private readonly canonical: () => StagedBlock[];
    private readonly failureReason: (error: unknown) => string;
    private readonly retainedIndex: (blockHash: string) => number;
    private readonly fetchHeader: (
        by: "latest" | bigint | string
    ) => Promise<BlockHeader>;
    private readonly stage: (
        headers: BlockHeader[],
        preFrom: "cache" | "chain"
    ) => Promise<StagedBlock[]>;
    private saveTimer?: ReturnType<typeof setTimeout>;

    constructor(options: PersistedCacheOptions) {
        this.store = options.store;
        this.stateCache = options.stateCache;
        this.watched = options.watched;
        this.logger = options.logger;
        this.stopping = options.stopping;
        this.canonical = options.canonical;
        this.failureReason = options.failureReason;
        this.retainedIndex = options.retainedIndex;
        this.fetchHeader = options.fetchHeader;
        this.stage = options.stage;
    }

    /** The cache and its newest blocks, as the file keeps them. */
    async saveNow(): Promise<void> {
        const canonical = this.canonical();
        if (canonical.length === 0) return;
        const cached = this.stateCache.cachedAddresses();
        const only = (diffs: AccountDiffs): AccountDiffs =>
            Object.fromEntries(
                Object.entries(diffs).filter(([address]) => cached.has(address))
            );
        const head = canonical[canonical.length - 1];
        const recent: PersistedBlock[] = canonical
            .slice(-PERSISTED_BLOCKS)
            .map((record) => ({
                number: record.number,
                hash: record.hash,
                parentHash: record.parentHash,
                pre: only(record.pre),
                post: only(record.post)
            }));
        try {
            await this.store.save({
                head: { number: head.number, hash: head.hash },
                cache: this.stateCache.exportAll(),
                recent
            });
        } catch (error) {
            this.logger.warn("Cannot save the cache", {
                reason: this.failureReason(error)
            });
        }
    }

    /** Writes the cache after a quiet time, so a burst of blocks is one write. */
    scheduleSave(): void {
        if (this.saveTimer || this.stopping.aborted) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.saveNow();
        }, SAVE_DEBOUNCE_MS);
        this.saveTimer.unref();
    }

    /**
     * Loads the saved cache, before the history is staged, and watches its
     * accounts so the staged records hold their values.
     */
    async restore(): Promise<PersistedState | undefined> {
        const saved = await this.store.load();
        if (!saved) return undefined;
        this.stateCache.importAll(saved.cache);
        for (const address of this.stateCache.cachedAddresses())
            this.watched.set(address, Promise.resolve());
        return saved;
    }

    /**
     * Brings the restored cache to the best head: undo the saved blocks a
     * reorg dropped, trace the blocks between the saved head and the retained
     * window, then apply the window's records. A file that does not lead
     * there is dropped.
     */
    async align(saved: PersistedState | undefined): Promise<void> {
        if (!saved) return;
        try {
            const canonical = this.canonical();
            const floor = BigInt(canonical[0].number);
            let index = -1;
            let below: { number: bigint } | undefined;
            for (const block of [...saved.recent].reverse()) {
                index = this.retainedIndex(block.hash);
                if (index >= 0) break;
                if (BigInt(block.number) < floor) {
                    const current = await this.fetchHeader(
                        BigInt(block.number)
                    );
                    if (current.hash === block.hash) {
                        below = { number: BigInt(block.number) };
                        break;
                    }
                }
                // dropped by a reorg since it was saved
                this.stateCache.applyBackward(block);
            }
            if (index < 0 && !below)
                throw new Error("No saved block is on the chain");
            if (below) {
                const headers: BlockHeader[] = [];
                for (let n = below.number + 1n; n < floor; n++)
                    headers.push(await this.fetchHeader(n));
                for (const record of await this.stage(headers, "chain"))
                    this.stateCache.applyForward(record);
            }
            for (let i = index + 1; i < canonical.length; i++)
                this.stateCache.applyForward(canonical[i]);
            this.logger.info("Resumed the cache from disk", {
                savedHead: saved.head.number,
                head: canonical[canonical.length - 1].number
            });
        } catch (error) {
            this.stateCache.clear();
            this.watched.clear();
            this.logger.warn("Dropped the saved cache", {
                reason: this.failureReason(error)
            });
        }
    }

    /** Drops the pending write and writes the cache now, as the service closes. */
    async flush(): Promise<void> {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        await this.saveNow();
    }
}
