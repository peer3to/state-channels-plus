import { signatureCacheKey } from "./SignerRecoveryCache";
import { Signature } from "@/types/types";
import { config } from "@/utils/config";

/**
 * Per-thread memo of the chain's verdict on a (message digest, signature)
 * pair: whether on-chain recovery (`UtilityFacet.retrieveSignerAddresses`,
 * OpenZeppelin `ECDSA.tryRecover`) accepts it. The verdict is a pure function
 * of its inputs, so this only skips repeating the local EVM call; the rule
 * itself stays in Solidity.
 *
 * Local-only derived data: never serialized or transmitted. One instance per
 * worker thread (module singleton). Bounded by SIGNER_RECOVERY_CACHE_MAX with
 * insertion-order (FIFO) eviction, like the signer recovery cache: an evicted
 * entry is simply classified again.
 */
// Key: signatureCacheKey(digest, signature). Value: true when the chain accepts it.
const cache = new Map<string, boolean>();

export function getChainSignatureVerdict(
    message: Uint8Array,
    signature: Signature
): boolean | undefined {
    return cache.get(signatureCacheKey(message, signature));
}

export function setChainSignatureVerdict(
    message: Uint8Array,
    signature: Signature,
    accepted: boolean
): void {
    cache.set(signatureCacheKey(message, signature), accepted);
    if (cache.size > config.SIGNER_RECOVERY_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
}

// Test-only helpers.
export function __resetChainSignatureVerdictCache(): void {
    cache.clear();
}
export function __chainSignatureVerdictCacheSize(): number {
    return cache.size;
}
