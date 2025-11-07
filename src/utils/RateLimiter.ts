import { config } from "./config";
import ATransport from "@/transport/ATransport";
import { MessageValidationService } from "./MessageValidationService";
import { MessageCache } from "./MessageCache";
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
 * Manager for per-connection inbound rate limiters with bandwidth management
 * Tracks message origin and prevents double-charging for gossiped messages
 */
export class InboundRateLimiterManager {
    private rateLimiters: WeakMap<ATransport, RateLimiter> = new WeakMap();
    private signerRateLimiters: Map<string, RateLimiter> = new Map();
    private readonly maxBandwidthBytesPerSecond: number;
    private readonly burstSizeBytes: number;
    private readonly validationService: MessageValidationService;
    private readonly messageCache: MessageCache;

    constructor(
        maxBandwidthBytesPerSecond: number,
        burstSizeBytes?: number,
        agreementTimeMs: number = 30000
    ) {
        this.maxBandwidthBytesPerSecond = maxBandwidthBytesPerSecond;
        this.burstSizeBytes = burstSizeBytes || maxBandwidthBytesPerSecond * 2;
        this.validationService = new MessageValidationService(agreementTimeMs);
        this.messageCache = new MessageCache(agreementTimeMs);
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
     * Check RPC message for bandwidth management with signature-based deduplication
     * @param serializedRpc - The serialized RPC message
     * @param dataSizeBytes - Size of the message in bytes
     * @returns Promise<boolean> - true if message should be allowed
     */
    async checkRpcMessage(
        serializedRpc: string,
        dataSizeBytes: number
    ): Promise<boolean> {
        try {
            const rpc = JSON.parse(serializedRpc);
            if (!rpc || !rpc.signature || !rpc.timestamp) {
                return false; // Invalid message format
            }

            // Validate timestamp freshness
            if (!this.validationService.isTimestampValid(rpc.timestamp)) {
                return false; // Message too old or too far in future
            }

            // Extract original signer from signature
            const originalSigner =
                await this.validationService.extractSignerFromRpc(rpc);
            if (!originalSigner) {
                return false; // Invalid signature
            }

            // Check for message deduplication
            if (this.messageCache.isCached(rpc)) {
                // Message already processed, don't charge bandwidth again
                return true;
            }

            // Get or create rate limiter for the original signer
            let signerRateLimiter = this.signerRateLimiters.get(originalSigner);
            if (!signerRateLimiter) {
                signerRateLimiter = new RateLimiter(
                    this.maxBandwidthBytesPerSecond,
                    this.burstSizeBytes
                );
                this.signerRateLimiters.set(originalSigner, signerRateLimiter);
            }

            // Check if the original signer has bandwidth available
            const allowed = signerRateLimiter.checkAndConsume(dataSizeBytes);

            if (allowed) {
                // Cache the message to prevent double-charging
                this.messageCache.cacheMessage(rpc, originalSigner);
            }

            return allowed;
        } catch (error) {
            console.error("Error in bandwidth management:", error);
            return false;
        }
    }

    /**
     * Remove rate limiter for a connection (cleanup)
     */
    removeConnection(transport: ATransport): void {
        // WeakMap will automatically clean up when transport is garbage collected
    }

    /**
     * Dispose of the rate limiter manager
     */
    dispose(): void {
        this.signerRateLimiters.clear();
        this.messageCache.dispose();
    }
}

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
