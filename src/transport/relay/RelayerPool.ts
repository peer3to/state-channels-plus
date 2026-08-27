import { Logger } from "@/utils";

// Full-pool failures use capped exponential backoff to avoid a reconnect loop.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
// Failover jitter spreads clients that lose the same relay at once.
const FAILOVER_JITTER_MAX_MS = 250;

export class RelayerPool {
    private readonly urls: string[];
    private readonly logger: Logger;
    private excludedRelayers: Set<string> = new Set();
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
        if (this.isExhausted) {
            this.scheduleRetryAfterExhaustion(retry);
            return;
        }
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

    // Empty configuration is not exhaustion; there was no failed round.
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
