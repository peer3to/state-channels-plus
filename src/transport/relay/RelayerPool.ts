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

export class RelayerPool {
    private readonly urls: string[];
    private readonly logger: Logger;
    // Relayers that failed since the last successful connection. Never
    // mutates urls - this is purely an exclusion filter that gets
    // reset once every configured relayer has failed (retry the pool) or
    // once a connection succeeds.
    private excludedRelayers: Set<string> = new Set();
    // Number of consecutive full-round exhaustions (every relayer excluded)
    // since the last successful connection. Drives the backoff delay.
    private backoffAttempt = 0;
    private pendingRetry: ReturnType<typeof setTimeout> | undefined;

    constructor(urls: string[], logger: Logger) {
        this.urls = urls;
        this.logger = logger;
    }

    /** Next candidate url, or undefined when the pool is empty/exhausted. */
    next(): string | undefined {
        const available = this.urls.filter(
            (url) => !this.excludedRelayers.has(url)
        );
        if (available.length === 0) return undefined;
        const index = Math.floor(Math.random() * available.length);
        return available[index];
    }

    /** Exclude a failed url and schedule the caller's retry (failover jitter or exhaustion backoff). */
    onFailure(url: string, retry: () => void): void {
        if (this.pendingRetry !== undefined) return;

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
        const delayMs = Math.random() * FAILOVER_JITTER_MAX_MS;
        this.scheduleRetry(retry, delayMs);
    }

    /** Clear exclusions and reset the backoff counter. Call on a successful open. */
    onSuccess(): void {
        this.excludedRelayers.clear();
        this.backoffAttempt = 0;
        if (this.pendingRetry !== undefined) {
            clearTimeout(this.pendingRetry);
            this.pendingRetry = undefined;
        }
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
        const cappedBackoffMs = Math.min(
            BACKOFF_BASE_MS * 2 ** this.backoffAttempt,
            BACKOFF_CAP_MS
        );
        // Full jitter (AWS-style): pick uniformly in [0, cappedBackoff] rather
        // than retrying at the deterministic cappedBackoff mark, so clients
        // that exhaust the pool at the same moment don't retry in lockstep.
        const delayMs = Math.random() * cappedBackoffMs;
        this.backoffAttempt++;
        this.logger.warn(
            "All holepunch relayers failed, retrying pool after backoff",
            { delayMs, cappedBackoffMs, relayerUrls: this.urls }
        );
        this.excludedRelayers.clear();
        this.scheduleRetry(retry, delayMs);
    }

    private scheduleRetry(retry: () => void, delayMs: number): void {
        this.pendingRetry = setTimeout(() => {
            this.pendingRetry = undefined;
            retry();
        }, delayMs);
    }
}
