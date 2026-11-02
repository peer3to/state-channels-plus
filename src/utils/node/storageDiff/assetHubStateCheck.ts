import { getBytes, hexlify } from "ethers";

/**
 * Pure helpers of the Asset Hub backfill: where a contract's child trie lives
 * on the Substrate node and which blocks changed it. They read the node only;
 * they never write.
 */

/** `0x`-prefixed hex string. */
type HexString = string;
/** Id of a contract's child trie (`ContractInfo.trie_id`). */
export type TrieId = HexString;
/** A block number on the chain being checked. */
type BlockNumber = number;

/**
 * `twox128("Revive") ++ twox128("AccountInfoOf")`: the top-trie prefix of the
 * `Revive::AccountInfoOf` map.
 */
const REVIVE_ACCOUNT_INFO_PREFIX =
    "735f040a5d490f1107ad9c56f5ca00d2ae37ff0591fdbbcd9c2406df7147a9dc";

/** Key prefix under which a child trie's root sits in the top trie. */
const CHILD_STORAGE_PREFIX = Buffer.from(":child_storage:default:").toString(
    "hex"
);

/**
 * Top-trie key of `Revive::AccountInfoOf(address)`: a map with an identity
 * hasher over the 20-byte address.
 */
export function reviveAccountInfoKey(address: string): HexString {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address))
        throw new Error("Not a 20-byte address");
    return "0x" + REVIVE_ACCOUNT_INFO_PREFIX + address.slice(2).toLowerCase();
}

/**
 * The child trie id in a SCALE `AccountInfo` value (`AccountType::Contract`
 * is variant 0 and starts with the compact-length `trie_id`), or undefined for
 * an account that is not a contract.
 */
export function trieIdOf(accountInfo: HexString): TrieId | undefined {
    const bytes = getBytes(accountInfo);
    if (bytes[0] !== 0) return undefined;
    const mode = bytes[1] & 3;
    if (mode !== 0) throw new Error("Unexpected trie id length encoding");
    const length = bytes[1] >> 2;
    if (bytes.length < 2 + length) throw new Error("Truncated account info");
    return hexlify(bytes.subarray(2, 2 + length));
}

/**
 * The prefixed storage key RPC calls name a child trie by; as a top-trie key
 * it also holds the child trie's root.
 */
export function childStorageKey(trieId: TrieId): HexString {
    return "0x" + CHILD_STORAGE_PREFIX + trieId.slice(2);
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
