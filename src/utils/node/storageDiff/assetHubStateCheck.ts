import type { StorageSlot, StorageWord } from "./blockStorageDiff";
import {
    blake2b256,
    bytesToHex,
    hexToBytes
} from "./includedHead/assetHubInclusion";

/**
 * Pure helpers of the Asset Hub completeness check: where a contract's child
 * trie lives on the Substrate node, how its keys relate to EVM slots, and which
 * blocks changed it. The check reads the node only; it never writes.
 */

/** `0x`-prefixed hex string. */
type HexString = string;
/** Id of a contract's child trie (`ContractInfo.trie_id`). */
export type TrieId = HexString;
/** Key of an entry in a contract's child trie: `blake2_256(slot)`. */
export type ChildKey = HexString;
/** A block number on the chain being checked. */
type BlockNumber = number;

const MASK64 = (1n << 64n) - 1n;
const XX_P1 = 11400714785074694791n;
const XX_P2 = 14029467366897019727n;
const XX_P3 = 1609587929392839161n;
const XX_P4 = 9650029242287828579n;
const XX_P5 = 2870177450012600261n;

/** Key prefix under which a child trie's root sits in the top trie. */
const CHILD_STORAGE_PREFIX = Buffer.from(":child_storage:default:").toString(
    "hex"
);

function rotl64(value: bigint, bits: bigint): bigint {
    return ((value << bits) | (value >> (64n - bits))) & MASK64;
}

/** xxHash64 of a short (under 32 bytes) input. */
function xxhash64(input: Uint8Array, seed: bigint): bigint {
    if (input.length >= 32) throw new Error("Input is not a short name");
    const view = new DataView(input.buffer, input.byteOffset, input.length);
    let hash = (seed + XX_P5 + BigInt(input.length)) & MASK64;
    let at = 0;
    for (; at + 8 <= input.length; at += 8) {
        const lane = view.getBigUint64(at, true);
        const mixed = (rotl64((lane * XX_P2) & MASK64, 31n) * XX_P1) & MASK64;
        hash = (rotl64(hash ^ mixed, 27n) * XX_P1 + XX_P4) & MASK64;
    }
    if (at + 4 <= input.length) {
        hash ^= (BigInt(view.getUint32(at, true)) * XX_P1) & MASK64;
        hash = (rotl64(hash, 23n) * XX_P2 + XX_P3) & MASK64;
        at += 4;
    }
    for (; at < input.length; at++) {
        hash ^= (BigInt(input[at]) * XX_P5) & MASK64;
        hash = (rotl64(hash, 11n) * XX_P1) & MASK64;
    }
    hash ^= hash >> 33n;
    hash = (hash * XX_P2) & MASK64;
    hash ^= hash >> 29n;
    hash = (hash * XX_P3) & MASK64;
    hash ^= hash >> 32n;
    return hash;
}

/** `twox128(name)` as hex without `0x`: xxHash64 with seeds 0 and 1, little-endian. */
function twox128(name: string): string {
    const input = Uint8Array.from(Buffer.from(name));
    const bytes = Buffer.alloc(16);
    bytes.writeBigUInt64LE(xxhash64(input, 0n), 0);
    bytes.writeBigUInt64LE(xxhash64(input, 1n), 8);
    return bytes.toString("hex");
}

/**
 * Top-trie key of `Revive::AccountInfoOf(address)`: a map with an identity
 * hasher over the 20-byte address.
 */
export function reviveAccountInfoKey(address: string): HexString {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address))
        throw new Error("Not a 20-byte address");
    return (
        "0x" +
        twox128("Revive") +
        twox128("AccountInfoOf") +
        address.slice(2).toLowerCase()
    );
}

/**
 * The child trie id in a SCALE `AccountInfo` value (`AccountType::Contract`
 * is variant 0 and starts with the compact-length `trie_id`), or undefined for
 * an account that is not a contract.
 */
export function trieIdOf(accountInfo: HexString): TrieId | undefined {
    const bytes = hexToBytes(accountInfo);
    if (bytes[0] !== 0) return undefined;
    const mode = bytes[1] & 3;
    if (mode !== 0) throw new Error("Unexpected trie id length encoding");
    const length = bytes[1] >> 2;
    if (bytes.length < 2 + length) throw new Error("Truncated account info");
    return bytesToHex(bytes.subarray(2, 2 + length));
}

/**
 * The prefixed storage key RPC calls name a child trie by; as a top-trie key
 * it also holds the child trie's root.
 */
export function childStorageKey(trieId: TrieId): HexString {
    return "0x" + CHILD_STORAGE_PREFIX + trieId.slice(2);
}

/** The child trie key of an EVM storage slot. */
export function childKeyOfSlot(slot: StorageSlot): ChildKey {
    return bytesToHex(blake2b256(hexToBytes(slot)));
}

/** How a contract's cached storage differs from its child trie. */
export interface ChildTrieComparison {
    /** Non-zero cached slots the child trie does not hold. */
    missing: StorageSlot[];
    /** Child trie keys no cached slot hashes to. */
    extra: ChildKey[];
    /** Non-zero cached slots whose value differs from the child trie's. */
    differing: StorageSlot[];
    /** Child trie entries, and non-zero cached slots, compared. */
    nodeEntries: number;
    cachedSlots: number;
}

/**
 * Compares the non-zero cached slots with the child trie entries (`values`:
 * child key to 32-byte word). The cache is complete exactly when `missing`,
 * `extra` and `differing` are all empty.
 */
export function compareChildTrie(
    cached: Record<StorageSlot, StorageWord>,
    values: Map<ChildKey, StorageWord>
): ChildTrieComparison {
    const expected = new Map<ChildKey, StorageSlot>();
    const missing: StorageSlot[] = [];
    const differing: StorageSlot[] = [];
    let cachedSlots = 0;
    for (const [slot, word] of Object.entries(cached)) {
        if (BigInt(word) === 0n) continue;
        cachedSlots++;
        const key = childKeyOfSlot(slot);
        expected.set(key, slot);
        const held = values.get(key);
        if (held === undefined) missing.push(slot);
        else if (BigInt(held) !== BigInt(word)) differing.push(slot);
    }
    const extra = [...values.keys()].filter((key) => !expected.has(key));
    return {
        missing,
        extra,
        differing,
        nodeEntries: values.size,
        cachedSlots
    };
}

/**
 * The blocks in `from`..`to` (exclusive of `from`) after which the child trie
 * root differs from the block before, found by bisecting the root. Costs about
 * log2(range) root reads per change; `rootsAt` reads a batch of roots in one
 * round trip, undefined for a trie that does not exist yet. A change undone
 * before `to` by a later one that restores the same root is not seen, which
 * leaves the final contents unaffected.
 */
export async function findChangedBlocks(
    rootsAt: (blocks: BlockNumber[]) => Promise<(HexString | undefined)[]>,
    from: BlockNumber,
    to: BlockNumber
): Promise<{ changed: BlockNumber[]; rootReads: number; roundTrips: number }> {
    const changed: BlockNumber[] = [];
    let rootReads = 0;
    let roundTrips = 0;
    const known = new Map<BlockNumber, HexString | undefined>();
    const read = async (blocks: BlockNumber[]) => {
        const fresh = [...new Set(blocks)].filter((n) => !known.has(n));
        if (fresh.length === 0) return;
        const roots = await rootsAt(fresh);
        roundTrips++;
        rootReads += fresh.length;
        fresh.forEach((n, i) => known.set(n, roots[i]));
    };
    await read([from, to]);
    let level: [BlockNumber, BlockNumber][] =
        known.get(from) === known.get(to) ? [] : [[from, to]];
    while (level.length > 0) {
        const splits = level.filter(([low, high]) => high - low > 1);
        for (const [, high] of level.filter(([a, b]) => b - a === 1))
            changed.push(high);
        await read(splits.map(([low, high]) => Math.floor((low + high) / 2)));
        level = splits.flatMap(([low, high]) => {
            const middle = Math.floor((low + high) / 2);
            const halves: [BlockNumber, BlockNumber][] = [];
            if (known.get(low) !== known.get(middle))
                halves.push([low, middle]);
            if (known.get(middle) !== known.get(high))
                halves.push([middle, high]);
            return halves;
        });
    }
    return { changed: changed.sort((a, b) => a - b), rootReads, roundTrips };
}
