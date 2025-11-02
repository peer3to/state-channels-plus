import { ethers } from "ethers";
import Clock from "@/Clock";

/**
 * Cache entry for a message
 */
interface MessageCacheEntry {
    timestamp: number;
    signer: string;
}

/**
 * Message Cache Service
 * Handles message deduplication to prevent double-charging for gossiped messages
 */
export class MessageCache {
    private messageCache: Map<string, MessageCacheEntry> = new Map();
    private readonly agreementTime: number; // in milliseconds
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(agreementTimeMs: number) {
        this.agreementTime = agreementTimeMs;
        this.startCleanup();
    }

    /**
     * Create a hash for message deduplication
     */
    private createMessageHash(rpc: any): string {
        return ethers.keccak256(
            ethers.toUtf8Bytes(
                JSON.stringify({
                    service: rpc.service,
                    method: rpc.method,
                    params: rpc.params,
                    timestamp: rpc.timestamp
                })
            )
        );
    }

    /**
     * Check if message is already cached (seen before)
     */
    isCached(rpc: any): boolean {
        const messageHash = this.createMessageHash(rpc);
        return this.messageCache.has(messageHash);
    }

    /**
     * Cache a message to prevent double-charging
     */
    cacheMessage(rpc: any, signer: string): void {
        const messageHash = this.createMessageHash(rpc);
        this.messageCache.set(messageHash, {
            timestamp: rpc.timestamp,
            signer: signer
        });
    }

    /**
     * Start cleanup process for expired messages
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Clock.getTimeInSeconds();
            for (const [hash, data] of this.messageCache.entries()) {
                if (
                    now - data.timestamp >
                    Math.floor(this.agreementTime / 1000)
                ) {
                    this.messageCache.delete(hash);
                }
            }
        }, this.agreementTime); // Clean up after agreement time has passed
    }

    /**
     * Dispose of the message cache
     */
    dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.messageCache.clear();
    }
}
