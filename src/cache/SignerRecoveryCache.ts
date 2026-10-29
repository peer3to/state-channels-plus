import { Address, Hash, Signature } from "@/types/types";
import { config } from "@/utils/config";
import {
    getBytes,
    hexlify,
    isHexString,
    Signature as EthersSignature,
    verifyMessage
} from "ethers";

/** One signer produced two different canonical signatures for one message. */
export type DoubleSignatureReport = {
    signer: Address;
    /** Hex of the signed message digest. */
    message: Hash;
    /** Canonical 65-byte form of the signature seen first. */
    firstSignature: Signature;
    /** Canonical 65-byte form of the conflicting signature. */
    secondSignature: Signature;
};

export type DoubleSignatureListener = (report: DoubleSignatureReport) => void;

/** `hex(message digest) + signature` as the caller supplied it. */
type RecoveryKey = string;
/** `hex(message digest) + recovered signer address`. */
type SignerMessageKey = string;

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
const cache = new Map<RecoveryKey, Address>();

/**
 * Double-signature memo: (message digest, signer) → canonical signature. Every
 * protocol signer is deterministic (RFC 6979), so an honest signer has exactly
 * one signature per message. Same bound and FIFO eviction as `cache`; an
 * evicted entry only means a later conflict against it goes unnoticed.
 */
const canonicalSignatures = new Map<SignerMessageKey, Signature>();

/**
 * Everyone in this thread that acts on a detected double signature. The cache
 * itself has no network side effects. All listeners hear every report: the
 * memo is shared by every runtime in the thread, so only the first one to
 * recover the conflicting signature can observe it.
 */
const doubleSignatureListeners = new Set<DoubleSignatureListener>();

function keyOf(messageHex: string, signature: Signature): RecoveryKey {
    return messageHex + signature;
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
    map.set(key, value);
    if (map.size > config.SIGNER_RECOVERY_CACHE_MAX) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
    }
}

/**
 * Remembers the signer's canonical signature for the message and reports a
 * different one. recoverSigner already rejects every encoding the contracts
 * reject (64-byte compact, v 0/1 or >= 35, high s), so the canonical form
 * (lowercase 65-byte hex) only folds hex letter case; re-encoding an honest
 * signature still never reports its signer.
 */
function checkDoubleSignature(
    messageHex: string,
    signature: Signature,
    signer: Address
): void {
    const key: SignerMessageKey = messageHex + signer;
    const canonical = EthersSignature.from(signature).serialized;
    const known = canonicalSignatures.get(key);
    if (known === undefined) {
        setBounded(canonicalSignatures, key, canonical);
        return;
    }
    if (known === canonical) return;
    const report: DoubleSignatureReport = {
        signer,
        message: messageHex,
        firstSignature: known,
        secondSignature: canonical
    };
    for (const listener of [...doubleSignatureListeners]) {
        try {
            listener(report);
        } catch {
            // Each listener owns its error handling and logging; a throwing
            // listener must not fail this recovery or starve the others.
        }
    }
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
    const messageHex = hexlify(message);
    const key = keyOf(messageHex, signature);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const address = verifyMessage(message, signature) as Address;
    setBounded(cache, key, address);
    checkDoubleSignature(messageHex, signature, address);
    return address;
}

/** Registers a double-signature listener; the returned function removes it. */
export function onDoubleSignature(
    listener: DoubleSignatureListener
): () => void {
    doubleSignatureListeners.add(listener);
    return () => doubleSignatureListeners.delete(listener);
}

// Test-only helpers.
export function __resetSignerRecoveryCache(): void {
    cache.clear();
    canonicalSignatures.clear();
}
export function __signerRecoveryCacheSize(): number {
    return cache.size;
}
export function __canonicalSignatureCacheSize(): number {
    return canonicalSignatures.size;
}
export function __doubleSignatureListenerCount(): number {
    return doubleSignatureListeners.size;
}
