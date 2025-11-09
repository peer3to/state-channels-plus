import { ethers } from "ethers";
import { Address, Hash } from "@/types/types";

type rpcHash = Hash;

/**
 * Message Cache Service
 * Handles message deduplication to prevent double-charging for gossiped messages
 */
export class MessageCache {
    private messageCache: Map<rpcHash, Set<Address>> = new Map();
    private readonly ttl: number; // in seconds

    constructor(ttl: number) {
        this.ttl = ttl;
    }

    /**
     * Create a hash for message deduplication
     */
    private createMessageHash(serializedRpc: string): string {
        return ethers.keccak256(ethers.toUtf8Bytes(serializedRpc));
    }

    /**
     * Check if message is already cached (seen before)
     * @param serializedRpc
     * @returns the hash of the message if cached, otherwise undefined
     */
    isCached(serializedRpc: string): rpcHash | undefined {
        const messageHash = this.createMessageHash(serializedRpc);
        if (this.messageCache.has(messageHash)) return messageHash;
        return undefined;
    }

    isAddressCached(rpcHash: rpcHash, address: Address): boolean {
        const set = this.messageCache.get(rpcHash);
        if (!set) return false;
        return set.has(address);
    }
    /**
     * Cache a message to prevent double-charging
     */
    cacheMessage(serializedRpc: string, signer: Address): void {
        const messageHash = this.createMessageHash(serializedRpc);
        const set = this.messageCache.get(messageHash);
        if (!set) {
            this.messageCache.set(messageHash, new Set<Address>([signer]));
            // TODO - think do we want to use timeoutManager for this
            setTimeout(() => {
                this.messageCache.delete(messageHash);
            }, this.ttl * 1000);
            return;
        }
        set.add(signer);
    }

    /**
     * Dispose of the message cache
     */
    dispose(): void {
        this.messageCache.clear();
    }
}
