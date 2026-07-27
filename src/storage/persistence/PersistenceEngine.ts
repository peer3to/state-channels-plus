import { NamespacedOp, PersistencePort } from "./PersistencePort";
import { PersistenceSchema, PruneWatermark } from "./PersistenceSchema";
import {
    HydrationRecordError,
    HydrationRecordFailure
} from "./HydrationRecordError";

export type DurabilityState = { degraded: boolean; err?: unknown };

export type PersistenceEngineOptions = {
    port: PersistencePort;
    /** Injected; wired to worker teardown by P2pRuntimeHost. */
    onFatal: (err: unknown) => void;
    /** Loud durability-degraded signal. */
    notify?: (state: DurabilityState) => void;
    /** Per-record hydrate corruption. */
    onError?: (err: unknown) => void;
    /** Bounded background retry schedule (ms). */
    retryBackoffMs?: number[];
    /** deadlineFraction default 0.5. */
    watchdog?: { timeoutWindowMs: number; deadlineFraction?: number };
    /** Background tick for non-release writes. */
    flushIntervalMs?: number;
};

type Timer = ReturnType<typeof setTimeout>;

type ShadowUpdate =
    | { op: "set"; id: string; key: string; changeKey: string }
    | { op: "del"; id: string; key: string };

const DEFAULT_RETRY_BACKOFF_MS = [50, 100, 250, 500, 1000];
const DEFAULT_DEADLINE_FRACTION = 0.5;

/**
 * Content-diff write-behind durability engine.
 *
 * Memory is authoritative; disk is a write-behind sink. The engine holds each
 * store's schema and captures durable state by CONTENT-DIFFING the store's
 * primary map at flush time - it never intercepts mutators. Flush, hydrate and
 * prune are SERIALIZED on one internal queue; two never run concurrently.
 */
export class PersistenceEngine {
    // --- collaborators / config ---
    // Not readonly: the host late-binds the real durable port at channel
    // connect via attachPort() (swapped on the serial queue).
    private port: PersistencePort;
    private readonly onFatal: (err: unknown) => void;
    private readonly notify?: (state: DurabilityState) => void;
    private readonly onError?: (err: unknown) => void;
    private readonly retryBackoffMs: number[];
    private readonly watchdogWindowMs?: number;
    private readonly watchdogFraction: number;
    private readonly flushIntervalMs?: number;

    // --- schemas + durable shadow ---
    private readonly schemas = new Map<string, PersistenceSchema<unknown>>();
    // durable-shadow: namespace -> (key -> changeKey last known durable).
    private readonly shadows = new Map<string, Map<string, string>>();

    // --- flush-generation barrier state (M1) ---
    // Increments when a flush STARTS and takes its diff snapshot.
    private lastStartedGen = 0;
    // Set to a flush's startedGen on commit SUCCESS only.
    private committedGen = 0;
    // A flush is queued but has not yet started (taken its snapshot).
    private pendingFlush = false;
    private readonly waiters: { gen: number; resolve: () => void }[] = [];

    // --- serial queue ---
    private queueTail: Promise<void> = Promise.resolve();

    // --- durability / degraded state ---
    private degraded = false;
    private fatal = false;
    private disposed = false;
    private lastErr: unknown;
    private retryIndex = 0;
    private retryTimer?: Timer;
    private watchdogTimer?: Timer;
    private intervalTimer?: Timer;

    constructor(opts: PersistenceEngineOptions) {
        this.port = opts.port;
        this.onFatal = opts.onFatal;
        this.notify = opts.notify;
        this.onError = opts.onError;
        this.retryBackoffMs =
            opts.retryBackoffMs && opts.retryBackoffMs.length > 0
                ? opts.retryBackoffMs
                : DEFAULT_RETRY_BACKOFF_MS;
        this.watchdogWindowMs = opts.watchdog?.timeoutWindowMs;
        this.watchdogFraction =
            opts.watchdog?.deadlineFraction ?? DEFAULT_DEADLINE_FRACTION;
        this.flushIntervalMs = opts.flushIntervalMs;

        if (this.flushIntervalMs && this.flushIntervalMs > 0) {
            this.intervalTimer = setInterval(
                () => this.enqueueFlush(),
                this.flushIntervalMs
            );
        }
    }

    register<V>(schema: PersistenceSchema<V>): void {
        this.schemas.set(
            schema.id,
            schema as unknown as PersistenceSchema<unknown>
        );
        if (!this.shadows.has(schema.id)) {
            this.shadows.set(schema.id, new Map());
        }
    }

    registeredIds(): ReadonlySet<string> {
        return new Set(this.schemas.keys());
    }

    /**
     * M1: binds to a flush whose memory snapshot is taken AT-OR-AFTER this
     * call. g = lastStartedGen + 1; a currently-in-flight flush's snapshot is
     * already taken (startedGen < g) and does NOT count, so we guarantee a NEW
     * flush starts. Resolves only when committedGen >= g. Concurrent awaits with
     * the same g coalesce onto the same next flush.
     */
    awaitDurable(): Promise<void> {
        const g = this.lastStartedGen + 1;
        this.enqueueFlush();
        // No same-tick shortcut: g = lastStartedGen + 1 so committedGen (<=
        // lastStartedGen) can never already satisfy g here.
        return new Promise<void>((resolve) => {
            this.waiters.push({ gen: g, resolve });
        });
    }

    /**
     * Merge-not-clear: replays each durable record through the store's REAL
     * mutator (merges over live memory, never clears). The durable-shadow is
     * seeded from the record AS-WRITTEN (decode -> changeKey) BEFORE replay, so
     * a pre-hydrate un-flushed live mutation is still diffed and persisted by
     * the next flush.
     *
     * Fail-closed (FR2): a commit is one durable transaction, and the
     * signature-release barrier may already have gossiped the block it
     * covers before the process died - a record that fails to decode/replay
     * is corruption of already-committed state, not evidence of an
     * incomplete write. Trusting it as safe-to-skip could resume at a prior
     * height and let the same signer create a conflicting block. Every
     * decode/replay failure across every store is therefore collected and
     * rethrown once all records are attempted, so the caller
     * (Storage.hydrate() -> ensurePersistenceForChannel) fails the channel
     * bind rather than resuming on state that can't be trusted.
     */
    hydrateAll(): Promise<void> {
        return this.enqueue(async () => {
            const failures: HydrationRecordFailure[] = [];
            for (const [id, schema] of this.schemas) {
                const shadow = this.shadowFor(id);
                for await (const record of this.port.load(id)) {
                    try {
                        // Seed shadow from the durable record as-written
                        // (pre-merge), never the post-merge live value.
                        if (schema.decode) {
                            const decoded = schema.decode(record.encoded);
                            shadow.set(record.key, schema.changeKey(decoded));
                        }
                        schema.replay(record.encoded, record.key);
                    } catch (err) {
                        this.onError?.(err);
                        failures.push({ namespace: id, key: record.key, err });
                    }
                }
            }
            if (failures.length > 0) {
                throw new HydrationRecordError(failures);
            }
        });
    }

    /**
     * be-07 near-follow: thin serialized pass-through calling port.prune per
     * namespace using schema.pruneKeep. Full policy is be-07.
     */
    prune(watermark: PruneWatermark): Promise<void> {
        return this.enqueue(async () => {
            for (const [id, schema] of this.schemas) {
                if (!schema.pruneKeep) continue;
                const keep = schema.pruneKeep.bind(schema);
                await this.port.prune(id, (r) => keep(r.key, watermark));
            }
        });
    }

    /**
     * Late-bind: swap in the real durable port for this channel and
     * clear every store's durable-shadow so the next flush re-diffs the full
     * live memory onto the new port. Enqueued on the single internal
     * serialization queue so it can never race a flush/hydrate/prune.
     *
     * Correctness for the pre-channel case: nothing real was committed to the
     * default in-memory port before a channel exists, so clearing shadows loses
     * nothing. The caller runs hydrateAll() AFTER this, which loads the new
     * port's durable records and re-seeds shadows from those records; any
     * live-only entry has no shadow and is persisted by the next flush
     * (merge-not-clear invariant preserved). No-op after dispose.
     */
    attachPort(port: PersistencePort): void {
        if (this.disposed) return;
        void this.enqueue(async () => {
            if (this.disposed) return;
            this.port = port;
            for (const shadow of this.shadows.values()) {
                shadow.clear();
            }
        });
    }

    /**
     * Teardown: stop every timer, DRAIN (enqueue+await the final flush,
     * retrying on the same backoff schedule as a steady-state degraded
     * commit until it durably commits - RO1/FR3), then mark terminal and
     * close the port. If every retry is exhausted without a successful
     * commit, disposal is NOT considered complete: `fatal` is never set, the
     * port is never closed, and dispose() rejects instead of silently
     * discarding dirty state - the idempotency guard resets so the caller
     * can call dispose() again (or the still-running background retry can
     * eventually catch up). `fatal` must stay false until the drain
     * completes - runFlush()'s terminal guard would otherwise skip this very
     * flush. Wired into host teardown by P2pRuntimeHost. Idempotent only on
     * a successful drain.
     */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.clearInterval();
        this.clearRetry();
        this.clearWatchdog();

        const committed = await this.enqueue(() => this.drainFinalFlush());
        if (!committed) {
            this.disposed = false;
            throw new Error(
                "PersistenceEngine.dispose: final flush did not durably commit after retries; port left open for recovery"
            );
        }
        this.fatal = true;
        await this.port.close?.();
    }

    /**
     * Runs on the serial queue (called from within an already-enqueued
     * task): attempts the final flush, retrying with the same backoff
     * schedule used for steady-state degraded commits. Clears any
     * background retryTimer runFlush() itself scheduled on failure so a
     * duplicate flush attempt can't race this loop's own retry.
     */
    private async drainFinalFlush(): Promise<boolean> {
        if (await this.runFlush()) return true;
        for (const delay of this.retryBackoffMs) {
            this.clearRetry();
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
            if (await this.runFlush()) return true;
        }
        this.clearRetry();
        return false;
    }

    // --- flush scheduling ---

    private enqueueFlush(): void {
        if (this.fatal) return;
        if (this.pendingFlush) return;
        this.pendingFlush = true;
        void this.enqueue(() => this.runFlush());
    }

    /** Returns whether the flush committed (or had nothing to commit); false on a caught failure. */
    private async runFlush(): Promise<boolean> {
        // Terminal guard: a flush already on the queue when dispose()/the
        // watchdog set `fatal` must not commit into a closed port or re-arm
        // the watchdog those paths just cleared.
        if (this.fatal) return true;
        // Snapshot phase: take the diff and stamp this flush's generation.
        const startedGen = ++this.lastStartedGen;
        this.pendingFlush = false;

        try {
            // Diff is inside the try: a throw from entries()/changeKey()/
            // encode() (e.g. encode's stray-bigint backstop) is a durability
            // failure and must route through onCommitFailure - never be
            // swallowed by the queue's rejection sink, which would hang
            // awaitDurable() forever.
            const ops: NamespacedOp[] = [];
            const shadowUpdates: ShadowUpdate[] = [];
            const dirtyKeyClears: {
                schema: PersistenceSchema<unknown>;
                entries: (readonly [string, number])[];
            }[] = [];

            for (const [id, schema] of this.schemas) {
                const shadow = this.shadowFor(id);

                if (
                    schema.peekDirtyKeys &&
                    schema.clearDirtyKeys &&
                    schema.getEntry
                ) {
                    // Bounded diff (PO1): only re-check keys touched since the
                    // last successful flush, not the whole retained history.
                    // Each entry carries the revision it was peeked at (RR1):
                    // clearDirtyKeys only clears it back if that revision is
                    // still current, so a same-key mutation landing while
                    // `port.commit()` below is in flight survives to the next
                    // flush instead of being silently dropped.
                    const dirtyEntries = Array.from(schema.peekDirtyKeys());
                    for (const [key] of dirtyEntries) {
                        const value = schema.getEntry(key);
                        if (value === undefined) {
                            if (shadow.has(key)) {
                                ops.push({ namespace: id, type: "del", key });
                                shadowUpdates.push({ op: "del", id, key });
                            }
                            continue;
                        }
                        const changeKey = schema.changeKey(value);
                        if (shadow.get(key) !== changeKey) {
                            ops.push({
                                namespace: id,
                                type: "put",
                                key,
                                encoded: schema.encode(value)
                            });
                            shadowUpdates.push({
                                op: "set",
                                id,
                                key,
                                changeKey
                            });
                        }
                    }
                    if (dirtyEntries.length > 0) {
                        dirtyKeyClears.push({ schema, entries: dirtyEntries });
                    }
                    continue;
                }

                // Full-scan fallback: the safe default for any schema that
                // doesn't opt into bounded diffing - still catches a
                // mutation however it happened.
                const seen = new Set<string>();
                for (const [key, value] of schema.entries()) {
                    seen.add(key);
                    const changeKey = schema.changeKey(value);
                    if (shadow.get(key) !== changeKey) {
                        ops.push({
                            namespace: id,
                            type: "put",
                            key,
                            encoded: schema.encode(value)
                        });
                        shadowUpdates.push({ op: "set", id, key, changeKey });
                    }
                }
                // Shadow keys absent from entries() are deleted (deleteBlock AND
                // pruning both model as a vanished key).
                for (const key of shadow.keys()) {
                    if (!seen.has(key)) {
                        ops.push({ namespace: id, type: "del", key });
                        shadowUpdates.push({ op: "del", id, key });
                    }
                }
            }

            if (ops.length > 0) await this.port.commit(ops);
            // ONLY on commit success advance the shadow + generation + clear
            // exactly the dirty keys this attempt diffed (anything mutated
            // again since the peek stays dirty for the next flush).
            this.applyShadowUpdates(shadowUpdates);
            for (const { schema, entries } of dirtyKeyClears) {
                schema.clearDirtyKeys!(entries);
            }
            if (startedGen > this.committedGen) this.committedGen = startedGen;
            this.onCommitSuccess();
            this.resolveWaiters();
            return true;
        } catch (err) {
            // Withhold: do NOT advance shadow or generation; barrier stays
            // pending, degraded is signalled, background retry re-diffs (a
            // failed commit re-diffs to the same ops - idempotent).
            this.onCommitFailure(err);
            return false;
        }
    }

    private applyShadowUpdates(updates: ShadowUpdate[]): void {
        for (const update of updates) {
            const shadow = this.shadowFor(update.id);
            if (update.op === "set") shadow.set(update.key, update.changeKey);
            else shadow.delete(update.key);
        }
    }

    private resolveWaiters(): void {
        for (let i = this.waiters.length - 1; i >= 0; i--) {
            if (this.waiters[i].gen <= this.committedGen) {
                const [waiter] = this.waiters.splice(i, 1);
                waiter.resolve();
            }
        }
    }

    // --- durability degraded / retry / watchdog ---

    private onCommitSuccess(): void {
        if (!this.degraded) return;
        this.degraded = false;
        this.retryIndex = 0;
        this.clearRetry();
        this.clearWatchdog();
        this.notify?.({ degraded: false });
    }

    private onCommitFailure(err: unknown): void {
        this.lastErr = err;
        if (!this.degraded) {
            this.degraded = true;
            this.notify?.({ degraded: true, err });
            this.startWatchdog();
        }
        this.scheduleRetry();
    }

    private scheduleRetry(): void {
        if (this.fatal) return;
        this.clearRetry();
        const idx = Math.min(this.retryIndex, this.retryBackoffMs.length - 1);
        const delay = this.retryBackoffMs[idx];
        this.retryIndex++;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.enqueueFlush();
        }, delay);
    }

    private startWatchdog(): void {
        if (this.fatal) return;
        if (this.watchdogWindowMs === undefined) return;
        this.clearWatchdog();
        const deadline = this.watchdogWindowMs * this.watchdogFraction;
        this.watchdogTimer = setTimeout(() => {
            this.watchdogTimer = undefined;
            if (!this.degraded || this.fatal) return;
            // Terminal fail-stop: the watchdog is the only reliable teardown
            // for a detached macrotask (a rejected await there is an unhandled
            // rejection, not a teardown). Stop background work and fire onFatal.
            this.fatal = true;
            this.clearRetry();
            // A torn-down engine must stop ticking against a dead port.
            this.clearInterval();
            this.onFatal(this.lastErr);
        }, deadline);
    }

    private clearInterval(): void {
        if (this.intervalTimer !== undefined) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = undefined;
        }
    }

    private clearRetry(): void {
        if (this.retryTimer !== undefined) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
    }

    private clearWatchdog(): void {
        if (this.watchdogTimer !== undefined) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = undefined;
        }
    }

    // --- helpers ---

    private shadowFor(id: string): Map<string, string> {
        let shadow = this.shadows.get(id);
        if (!shadow) {
            shadow = new Map();
            this.shadows.set(id, shadow);
        }
        return shadow;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queueTail.then(task, task);
        this.queueTail = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }
}
