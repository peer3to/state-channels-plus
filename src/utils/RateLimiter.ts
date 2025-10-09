import { config } from "./config";

/**
 * Implements a token bucket algorithm for rate limiting (using bytes directly)
 */
export class RateLimiter {
    private availableBytes: number;
    private lastRefillTime: number;
    private readonly maxBytes: number;
    private readonly refillRateBytesPerSecond: number;

    constructor(maxBandwidthBytesPerSecond: number, burstSizeBytes?: number) {
        this.refillRateBytesPerSecond = maxBandwidthBytesPerSecond;

        // Set max bytes (burst capacity)
        this.maxBytes = burstSizeBytes ?? maxBandwidthBytesPerSecond * 2; // 2 seconds of burst by default

        this.availableBytes = this.maxBytes;
        this.lastRefillTime = Date.now();
    }

    /**
     * Check if data can be sent and consume bytes
     * @param dataSizeBytes - Size of data to send in bytes
     * @returns true if data can be sent, false if rate limited
     */
    checkAndConsume(dataSizeBytes: number): boolean {
        const now = Date.now();
        const timePassed = (now - this.lastRefillTime) / 1000; // seconds

        // Refill bytes based on time passed
        const bytesToAdd = timePassed * this.refillRateBytesPerSecond;
        this.availableBytes = Math.min(
            this.maxBytes,
            this.availableBytes + bytesToAdd
        );
        this.lastRefillTime = now;

        if (this.availableBytes >= dataSizeBytes) {
            // Sufficient bytes available
            this.availableBytes -= dataSizeBytes;
            return true;
        }

        // Not enough bytes, rate limited
        return false;
    }

    /**
     * Get current available bytes (for monitoring)
     */
    getAvailableBytes(): number {
        return this.availableBytes;
    }

    /**
     * Get current bandwidth utilization (0-1)
     */
    getUtilization(): number {
        return 1 - this.availableBytes / this.maxBytes;
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.availableBytes = this.maxBytes;
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
