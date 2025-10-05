import { config } from "./config";

/**
 * Implements a token bucket algorithm for rate limiting
 */
export class RateLimiter {
    private tokens: number;
    private lastRefillTime: number;
    private readonly maxTokens: number;
    private readonly refillRate: number; // tokens per second
    private readonly tokenSize: number; // bytes per token

    constructor(maxBandwidthBytesPerSecond: number, burstSizeBytes?: number) {
        // Convert bandwidth to tokens per second
        this.tokenSize = 1024; // 1KB per token (configurable)
        this.refillRate = maxBandwidthBytesPerSecond / this.tokenSize;

        // Set max tokens (burst capacity)
        this.maxTokens = burstSizeBytes
            ? Math.max(burstSizeBytes / this.tokenSize, 1)
            : Math.max(this.refillRate * 2, 1); // 2 seconds of burst by default

        this.tokens = this.maxTokens;
        this.lastRefillTime = Date.now();
    }

    /**
     * Check if data can be sent and consume tokens
     * @param dataSizeBytes - Size of data to send in bytes
     * @returns true if data can be sent, false if rate limited
     */
    checkAndConsume(dataSizeBytes: number): boolean {
        const now = Date.now();
        const timePassed = (now - this.lastRefillTime) / 1000; // seconds

        // Refill tokens based on time passed
        const tokensToAdd = timePassed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefillTime = now;

        const tokensNeeded = Math.ceil(dataSizeBytes / this.tokenSize);

        if (this.tokens >= tokensNeeded) {
            // Sufficient tokens available
            this.tokens -= tokensNeeded;
            return true;
        }

        // Not enough tokens, rate limited
        return false;
    }

    /**
     * Get current token count (for monitoring)
     * Not used yet
     */
    getTokenCount(): number {
        return this.tokens;
    }

    /**
     * Get current bandwidth utilization (0-1)
     * Not used yet
     */
    getUtilization(): number {
        return 1 - this.tokens / this.maxTokens;
    }

    /**
     * Reset the rate limiter
     * Not used yet
     */
    reset(): void {
        this.tokens = this.maxTokens;
        this.lastRefillTime = Date.now();
    }
}

/**
 * Global rate limiter instance for all transports
 * Uses configuration values for rate limiting
 */
export const globalRateLimiter = config.RATE_LIMIT_ENABLED
    ? new RateLimiter(
          config.RATE_LIMIT_BYTES_PER_SECOND,
          config.RATE_LIMIT_BURST_SIZE
      )
    : null;
