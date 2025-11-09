import { config } from "./config";
import Clock from "@/Clock";

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
        this.lastRefillTime = 0;
    }

    /**
     * Check if data can be sent and consume bytes
     * @param dataSizeBytes - Size of data to send in bytes
     * @returns true if data can be sent, false if rate limited
     */
    checkAndConsume(dataSizeBytes: number): boolean {
        const now = Clock.getTimeInSeconds();
        const timePassed = now - this.lastRefillTime;

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
        this.lastRefillTime = Clock.getTimeInSeconds();
    }
}

export function createRateLimiter(): RateLimiter {
    let bytesPerSecondLimit = 1048576; // 1*1024*1024 == 1MB
    let bytesBurstLimit = 2097152; // 2*1024*1024 == 2MB
    if (config.RATE_LIMIT_ENABLED) {
        bytesPerSecondLimit =
            config.RATE_LIMIT_BYTES_PER_SECOND || bytesPerSecondLimit;
        bytesBurstLimit = config.RATE_LIMIT_BURST_SIZE || bytesBurstLimit;
    }
    return new RateLimiter(bytesPerSecondLimit, bytesBurstLimit);
}
