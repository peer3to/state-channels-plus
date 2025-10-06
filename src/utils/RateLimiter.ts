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
 * Global outbound rate limiter instance for all transports
 * Uses configuration values for rate limiting
 */
export const outboundRateLimiter = config.RATE_LIMIT_ENABLED
    ? new RateLimiter(
          config.RATE_LIMIT_BYTES_PER_SECOND,
          config.RATE_LIMIT_BURST_SIZE
      )
    : null;

/**
 * Manager for per-connection inbound rate limiters
 */
export class InboundRateLimiterManager {
    private rateLimiters: WeakMap<ATransport, RateLimiter> = new WeakMap();
    private readonly maxBandwidthBytesPerSecond: number;
    private readonly burstSizeBytes: number;

    constructor(maxBandwidthBytesPerSecond: number, burstSizeBytes?: number) {
        this.maxBandwidthBytesPerSecond = maxBandwidthBytesPerSecond;
        this.burstSizeBytes = burstSizeBytes || maxBandwidthBytesPerSecond * 2;
    }

    /**
     * Get or create rate limiter for a transport connection
     */
    getRateLimiter(transport: ATransport): RateLimiter {
        let rateLimiter = this.rateLimiters.get(transport);
        if (!rateLimiter) {
            rateLimiter = new RateLimiter(
                this.maxBandwidthBytesPerSecond,
                this.burstSizeBytes
            );
            this.rateLimiters.set(transport, rateLimiter);
        }
        return rateLimiter;
    }

    /**
     * Check if incoming data should be allowed and consume tokens
     */
    checkInboundMessage(transport: ATransport, dataSizeBytes: number): boolean {
        const rateLimiter = this.getRateLimiter(transport);
        return rateLimiter.checkAndConsume(dataSizeBytes);
    }

    /**
     * Remove rate limiter for a connection (cleanup)
     */
    removeConnection(transport: ATransport): void {
        // WeakMap will automatically clean up when transport is garbage collected
    }
}

// Import ATransport type
import ATransport from "@/transport/ATransport";

/**
 * Global inbound rate limiter manager instance
 * Uses same configuration as outbound rate limiting
 */
export const inboundRateLimiterManager = config.RATE_LIMIT_ENABLED
    ? new InboundRateLimiterManager(
          config.RATE_LIMIT_BYTES_PER_SECOND,
          config.RATE_LIMIT_BURST_SIZE
      )
    : null;
