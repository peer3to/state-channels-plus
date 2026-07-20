import { verifyMessage, hexlify } from "ethers";
import { Address, Signature } from "@/types/types";
import { config } from "@/utils/config";

/**
 * Per-thread memo of ECDSA signer recovery, keyed by (message digest, signature).
 * `verifyMessage` is a pure function of its inputs, so this only skips repeating
 * the secp256k1 work — never changes who a signature resolves to. Generic over
 * byte-message signatures (blocks, join/open/transaction/dispute), not just blocks.
 *
 * Local-only derived data: never serialized or transmitted. One instance per
 * worker thread (module singleton). Bounded by SIGNER_RECOVERY_CACHE_MAX with
 * insertion-order (FIFO) eviction — an evicted entry is simply recovered again.
 */
const cache = new Map<string, Address>();

function keyOf(message: Uint8Array, signature: Signature): string {
    return hexlify(message) + signature;
}

export function recoverSigner(
    message: Uint8Array,
    signature: Signature
): Address {
    const key = keyOf(message, signature);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const address = verifyMessage(message, signature) as Address;
    cache.set(key, address);
    if (cache.size > config.SIGNER_RECOVERY_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return address;
}

// Test-only helpers.
export function __resetSignerRecoveryCache(): void {
    cache.clear();
}
export function __signerRecoveryCacheSize(): number {
    return cache.size;
}
