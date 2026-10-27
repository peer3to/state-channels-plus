/**
 * Pure helpers of the Asset Hub inclusion strategy: storage keys, SCALE
 * decoding of a relay chain parachain head, and the Substrate header hash.
 */

/** `0x`-prefixed hex string. */
type HexString = string;
/** Substrate block hash (blake2-256 of the SCALE header), `0x` + 64 hex digits. */
export type SubstrateHash = string;

/** `twox128("Paras") ++ twox128("Heads")`, the relay chain `Paras::Heads` map. */
const PARAS_HEADS_PREFIX =
    "0xcd710b30bd2eab0352ddcc26417aa1941b3c252fcb29d88eff4f3de5de4476c3";
/**
 * `twox128("Revive") ++ twox128("BlockHash")`: Asset Hub's `Revive::BlockHash`
 * map, keyed by the block number as u32 LE with an identity hasher. Derived
 * once with the standard xxHash64 twox128 and checked against a recorded key.
 */
const REVIVE_BLOCK_HASH_PREFIX =
    "0x735f040a5d490f1107ad9c56f5ca00d2a44704b568d21667356a5a050c118746";

const U32_MAX = 0xffffffff;
const MASK64 = (1n << 64n) - 1n;
const XX_P1 = 11400714785074694791n;
const XX_P2 = 14029467366897019727n;
const XX_P3 = 1609587929392839161n;
const XX_P5 = 2870177450012600261n;

const BLAKE_IV = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n
];
const BLAKE_SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]
];

function rotr64(value: bigint, bits: bigint): bigint {
    return ((value >> bits) | (value << (64n - bits))) & MASK64;
}

function rotl64(value: bigint, bits: bigint): bigint {
    return ((value << bits) | (value >> (64n - bits))) & MASK64;
}

export function hexToBytes(hex: HexString): Uint8Array {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Malformed hex");
    return Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
}

export function bytesToHex(bytes: Uint8Array): HexString {
    return "0x" + Buffer.from(bytes).toString("hex");
}

/** Unkeyed BLAKE2b with a 32-byte digest (RFC 7693), as Substrate hashes. */
export function blake2b256(input: Uint8Array): Uint8Array {
    const h = [...BLAKE_IV];
    h[0] ^= 0x01010000n ^ 32n;
    const blockCount = Math.max(1, Math.ceil(input.length / 128));
    for (let block = 0; block < blockCount; block++) {
        const last = block === blockCount - 1;
        const chunk = new Uint8Array(128);
        chunk.set(input.subarray(block * 128, (block + 1) * 128));
        const view = new DataView(chunk.buffer);
        const m = Array.from({ length: 16 }, (_, i) =>
            view.getBigUint64(i * 8, true)
        );
        const v = [...h, ...BLAKE_IV];
        v[12] ^= BigInt(last ? input.length : (block + 1) * 128);
        if (last) v[14] ^= MASK64;
        const mix = (
            a: number,
            b: number,
            c: number,
            d: number,
            x: bigint,
            y: bigint
        ) => {
            v[a] = (v[a] + v[b] + x) & MASK64;
            v[d] = rotr64(v[d] ^ v[a], 32n);
            v[c] = (v[c] + v[d]) & MASK64;
            v[b] = rotr64(v[b] ^ v[c], 24n);
            v[a] = (v[a] + v[b] + y) & MASK64;
            v[d] = rotr64(v[d] ^ v[a], 16n);
            v[c] = (v[c] + v[d]) & MASK64;
            v[b] = rotr64(v[b] ^ v[c], 63n);
        };
        for (let round = 0; round < 12; round++) {
            const s = BLAKE_SIGMA[round % 10];
            mix(0, 4, 8, 12, m[s[0]], m[s[1]]);
            mix(1, 5, 9, 13, m[s[2]], m[s[3]]);
            mix(2, 6, 10, 14, m[s[4]], m[s[5]]);
            mix(3, 7, 11, 15, m[s[6]], m[s[7]]);
            mix(0, 5, 10, 15, m[s[8]], m[s[9]]);
            mix(1, 6, 11, 12, m[s[10]], m[s[11]]);
            mix(2, 7, 8, 13, m[s[12]], m[s[13]]);
            mix(3, 4, 9, 14, m[s[14]], m[s[15]]);
        }
        for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    const digest = new DataView(new ArrayBuffer(64));
    h.forEach((word, i) => digest.setBigUint64(i * 8, word, true));
    return new Uint8Array(digest.buffer, 0, 32);
}

/** Little-endian u32 bytes. */
function u32le(value: number): Uint8Array {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
        throw new Error("Value is not a u32");
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

/** xxHash64 (seed 0) of a u32's LE bytes, written little-endian: `twox64`. */
function twox64OfU32(value: number): Uint8Array {
    const input = BigInt(new DataView(u32le(value).buffer).getUint32(0, true));
    let hash = (XX_P5 + 4n) & MASK64;
    hash ^= (input * XX_P1) & MASK64;
    hash = (rotl64(hash, 23n) * XX_P2 + XX_P3) & MASK64;
    hash ^= hash >> 33n;
    hash = (hash * XX_P2) & MASK64;
    hash ^= hash >> 29n;
    hash = (hash * XX_P3) & MASK64;
    hash ^= hash >> 32n;
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setBigUint64(0, hash, true);
    return new Uint8Array(bytes.buffer);
}

/** Relay chain storage key of `Paras::Heads(paraId)`. */
export function paraHeadKey(paraId: number): HexString {
    return (
        PARAS_HEADS_PREFIX +
        Buffer.from(twox64OfU32(paraId)).toString("hex") +
        Buffer.from(u32le(paraId)).toString("hex")
    );
}

/** Asset Hub storage key of `Revive::BlockHash(number)`. */
export function reviveBlockHashKey(number: number): HexString {
    return (
        REVIVE_BLOCK_HASH_PREFIX + Buffer.from(u32le(number)).toString("hex")
    );
}

/** A SCALE compact integer at `offset`: its value and the bytes it took. */
function readCompact(bytes: Uint8Array, offset: number): [number, number] {
    const first = bytes[offset];
    if (first === undefined) throw new Error("Truncated SCALE compact");
    const mode = first & 3;
    const width = mode === 0 ? 1 : mode === 1 ? 2 : mode === 2 ? 4 : 0;
    if (width === 0) throw new Error("Unsupported SCALE big-integer compact");
    if (offset + width > bytes.length)
        throw new Error("Truncated SCALE compact");
    let value = 0;
    for (let i = width - 1; i >= 0; i--)
        value = value * 256 + bytes[offset + i];
    return [Math.floor(value / 4), width];
}

/** The included parachain block a relay `Paras::Heads` value names. */
export function decodeParaHead(value: HexString): {
    number: number;
    substrateHash: SubstrateHash;
} {
    const bytes = hexToBytes(value);
    // HeadData is a SCALE Vec<u8> around the SCALE parachain header.
    const [length, width] = readCompact(bytes, 0);
    const header = bytes.subarray(width, width + length);
    if (header.length !== length || length < 33) {
        throw new Error("Malformed parachain head");
    }
    // Header: parentHash (32 bytes), then the block number as a compact.
    const [number] = readCompact(header, 32);
    return { number, substrateHash: bytesToHex(blake2b256(header)) };
}
