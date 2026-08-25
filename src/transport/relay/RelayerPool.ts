import { Logger } from "@/utils";

// Base/cap for exponential backoff applied when a full round of relayers
// has just been exhausted (all configured relayers failed since the last
// success), so a fully-down network doesn't tight-loop hammering reconnects.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
// Upper bound for the randomized delay before retrying after a single
// relayer failure, so many clients failing over at the same instant don't
// all pile onto the next relayer at once (thundering herd).
const FAILOVER_JITTER_MAX_MS = 250;

export type RelayerPoolDeps = {
    urls: string[];
    logger: Logger;
    schedule?: (fn: () => void, ms: number) => void;
    random?: () => number;
};

// Reusable relayer-pool selection, non-destructive exclusion and full-jitter
// backoff, extracted so both HolepunchRelay (transport) and the browser lobby
// swarm can share one implementation instead of drifting copies. Owns no
// socket/swarm/DHT - the caller connects, this only tracks which url to try
// next and when to retry after a failure.
export class RelayerPool {
    private readonly urls: string[];
    private readonly logger: Logger;
    private readonly schedule: (fn: () => void, ms: number) => void;
    private readonly random: () => number;

    // Relayers that failed since the last successful connection. Never
    // mutates urls - this is purely an exclusion filter that gets reset
    // once every configured relayer has failed (retry the pool) or once a
    // connection succeeds.
    private excludedRelayers: Set<string> = new Set();
    // Number of consecutive full-round exhaustions (every relayer excluded)
    // since the last successful connection. Drives the backoff delay.
    private backoffAttempt = 0;
    // Set while a scheduled retry (failover jitter or exhaustion backoff) has
    // not yet run; cleared only when that retry actually fires. This is the
    // dedup signal for onFailure, not "already excluded" - deliberately
    // hardened over the original HolepunchRelay (which had no dedup at all):
    // an exhausting failure clears excludedRelayers synchronously before its
    // retry fires, so a same-url "already excluded" check would be defeated
    // by a socket that fires both "error" and "close" for one failure.
    private hasPendingRetry = false;

    constructor(deps: RelayerPoolDeps) {
        this.urls = deps.urls;
        this.logger = deps.logger;
        this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
        this.random = deps.random ?? Math.random;
    }

    /** Next candidate url, or undefined when the pool is empty/exhausted. */
    next(): string | undefined {
        const available = this.urls.filter(
            (url) => !this.excludedRelayers.has(url)
        );
        if (available.length === 0) return undefined;
        const index = Math.floor(this.random() * available.length);
        return available[index];
    }

    /** Exclude a failed url and schedule the caller's retry (failover jitter or exhaustion backoff). */
    onFailure(url: string, retry: () => void): void {
        // A retry is already scheduled for a prior failure (e.g. a socket
        // firing both "error" and "close" for the same failure) - don't
        // double-schedule a second one, and don't double-count it toward
        // the exhaustion backoff. This guard is global (one pending retry
        // for the whole pool), not per-url - it assumes a single-flight
        // caller with at most one connection attempt in progress at a time
        // (true for HolepunchRelay). A caller that runs concurrent attempts
        // against different urls needs its own dedup, not this flag.
        if (this.hasPendingRetry) return;

        this.excludedRelayers.add(url);
        this.logger.debug("Excluded holepunch relayer after failure", {
            excluded: url,
            excludedCount: this.excludedRelayers.size,
            total: this.urls.length
        });
        // Branch immediately so a pool-exhausting failure schedules only the
        // exhaustion backoff, never the failover jitter as well - one timer
        // owner per failure, not two stacked delays.
        if (this.isExhausted) {
            this.scheduleRetryAfterExhaustion(retry);
            return;
        }
        // Randomized delay so many clients failing over off the same
        // relayer at once don't all hit the next relayer simultaneously.
        const delayMs = this.random() * FAILOVER_JITTER_MAX_MS;
        this.scheduleRetry(retry, delayMs);
    }

    /** Clear exclusions and reset the backoff counter. Call on a successful open. */
    onSuccess(): void {
        this.excludedRelayers.clear();
        this.backoffAttempt = 0;
        // A successful connection supersedes any retry that was scheduled
        // before it landed - otherwise the pending-retry flag would stay
        // stuck true forever and onFailure would silently swallow every
        // future failure (no exclusion, no retry, no backoff).
        this.hasPendingRetry = false;
    }

    // True once every configured relayer has failed since the last success
    // (or since the last reset). Never true when urls is empty.
    get isExhausted(): boolean {
        return (
            this.urls.length > 0 &&
            this.urls.every((url) => this.excludedRelayers.has(url))
        );
    }

    private scheduleRetryAfterExhaustion(retry: () => void): void {
        // Full jitter (AWS-style): pick uniformly in [0, cappedBackoff] rather
        // than retrying at the deterministic cappedBackoff mark, so clients
        // that exhaust the pool at the same moment don't retry in lockstep.
        const cappedBackoffMs = Math.min(
            BACKOFF_BASE_MS * 2 ** this.backoffAttempt,
            BACKOFF_CAP_MS
        );
        const delayMs = this.random() * cappedBackoffMs;
        this.backoffAttempt++;
        this.logger.warn(
            "All holepunch relayers failed, retrying pool after backoff",
            { delayMs, cappedBackoffMs, relayerUrls: this.urls }
        );
        this.excludedRelayers.clear();
        this.scheduleRetry(retry, delayMs);
    }

    // Single scheduling choke point so hasPendingRetry is set exactly when a
    // timer is scheduled and cleared exactly when it fires - never based on
    // excludedRelayers, which an exhaustion retry clears before its own timer
    // fires.
    private scheduleRetry(retry: () => void, delayMs: number): void {
        this.hasPendingRetry = true;
        this.schedule(() => {
            this.hasPendingRetry = false;
            retry();
        }, delayMs);
    }
}
