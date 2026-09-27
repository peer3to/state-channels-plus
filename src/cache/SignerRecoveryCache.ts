import { Address, Signature } from "@/types/types";
import { config } from "@/utils/config";
import { getBytes, hexlify, isHexString, verifyMessage } from "ethers";

// secp256k1 group order and its half: the contracts' OpenZeppelin ECDSA
// rejects an `s` above half the order (malleable) and ecrecover rejects an
// `r` or `s` outside [1, n - 1].
const SECP256K1_N =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

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

/**
 * Whether the contracts accept this signature encoding: OpenZeppelin's
 * `ECDSA.tryRecover(bytes32, bytes)` takes exactly 65 bytes (r, s, v), rejects
 * a high `s`, and ecrecover returns no signer for a `v` other than 27 or 28 or
 * an `r`/`s` outside the group. ethers is more permissive (64-byte compact
 * signatures, `v` of 0/1 or EIP-155 values), so every recovery checks this
 * first and never accepts a signature the chain would reject.
 */
export function isContractAcceptedSignature(signature: Signature): boolean {
    if (!isHexString(signature, 65)) return false;
    const bytes = getBytes(signature);
    const v = bytes[64];
    if (v !== 27 && v !== 28) return false;
    const r = BigInt(hexlify(bytes.subarray(0, 32)));
    const s = BigInt(hexlify(bytes.subarray(32, 64)));
    return r > 0n && r < SECP256K1_N && s > 0n && s <= SECP256K1_HALF_N;
}

/**
 * The signer of `signature` over `message` under the contracts' acceptance
 * rule; throws for a signature the contracts reject (see
 * isContractAcceptedSignature) or one that recovers no key.
 */
export function recoverSigner(
    message: Uint8Array,
    signature: Signature
): Address {
    if (!isContractAcceptedSignature(signature)) {
        throw new Error("signature is not accepted by the contracts");
    }
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
