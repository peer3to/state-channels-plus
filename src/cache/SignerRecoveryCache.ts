import { Address, Signature } from "@/types/types";
import { config } from "@/utils/config";
import { verifyMessage, hexlify, Signature as EthersSignature } from "ethers";

/** One signer produced two different canonical signatures for one message. */
export type DoubleSignatureReport = {
    signer: Address;
    /** Hex of the signed message digest. */
    message: string;
    /** Canonical 65-byte hex of the signature seen first. */
    firstSignature: string;
    /** Canonical 65-byte hex of the conflicting signature. */
    secondSignature: string;
};

export type DoubleSignatureListener = (report: DoubleSignatureReport) => void;

/** `hex(message digest) + signature` as the caller supplied it. */
type RecoveryKey = string;
/** `hex(message digest) + recovered signer address`. */
type SignerMessageKey = string;

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
// Values are canonical 65-byte signature hex.
const canonicalSignatures = new Map<SignerMessageKey, string>();

/**
 * Everyone in this thread that acts on a detected double signature. The cache
 * itself has no network side effects. All listeners hear every report: the
 * memo is shared by every runtime in the thread, so only the first one to
 * recover the conflicting signature can observe it.
 */
const doubleSignatureListeners = new Set<DoubleSignatureListener>();

function keyOf(message: Uint8Array, signature: Signature): RecoveryKey {
    return hexlify(message) + signature;
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
 * different one. Canonical form (65 bytes, v 27/28) maps v 0/1, v >= 35 and
 * 64-byte compact encodings of one signature onto one value, so re-encoding
 * an honest signature never reports its signer.
 */
function checkDoubleSignature(
    message: Uint8Array,
    signature: Signature,
    signer: Address
): void {
    const messageHex = hexlify(message);
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
    for (const listener of [...doubleSignatureListeners]) listener(report);
}

export function recoverSigner(
    message: Uint8Array,
    signature: Signature
): Address {
    const key = keyOf(message, signature);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const address = verifyMessage(message, signature) as Address;
    setBounded(cache, key, address);
    checkDoubleSignature(message, signature, address);
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
