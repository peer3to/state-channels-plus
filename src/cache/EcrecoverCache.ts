import { config } from "@/utils/config";
import type { EVM } from "@ethereumjs/evm";
import { bytesToHex, ecrecover } from "@ethereumjs/util";

/**
 * Per-thread memo of the local EVM's ecrecover precompile, keyed by
 * (hash, v, r, s, chainId). Mirror calls re-verify the same confirmation
 * signatures many times (every finality, state-proof and balance check of a
 * dispute), and each recovery is pure JS secp256k1 on the VM thread. Recovery
 * is a pure function of its inputs, so the memo never changes a result; a
 * failed recovery is not memoized and throws again as before.
 *
 * Local-only derived data. Bounded by SIGNER_RECOVERY_CACHE_MAX with
 * insertion-order (FIFO) eviction — an evicted entry is simply recovered again.
 */
const cache = new Map<string, Uint8Array>();

function memoizedEcrecover(
    recover: typeof ecrecover
): (
    msgHash: Uint8Array,
    v: bigint,
    r: Uint8Array,
    s: Uint8Array,
    chainId?: bigint
) => Uint8Array {
    return (msgHash, v, r, s, chainId) => {
        const key = `${bytesToHex(msgHash)}:${v}:${bytesToHex(r)}:${bytesToHex(s)}:${chainId ?? ""}`;
        const cached = cache.get(key);
        // A copy: callers own the returned bytes.
        if (cached !== undefined) return cached.slice();
        const publicKey = recover(msgHash, v, r, s, chainId);
        cache.set(key, publicKey.slice());
        if (cache.size > config.SIGNER_RECOVERY_CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        return publicKey;
    };
}

/** Route `evm`'s ecrecover precompile through the per-thread memo. */
export function installEcrecoverCache(evm: EVM): void {
    const customCrypto = evm.common.customCrypto;
    customCrypto.ecrecover = memoizedEcrecover(
        customCrypto.ecrecover ?? ecrecover
    );
}

// Test-only helpers.
export function __resetEcrecoverCache(): void {
    cache.clear();
}
export function __ecrecoverCacheSize(): number {
    return cache.size;
}
