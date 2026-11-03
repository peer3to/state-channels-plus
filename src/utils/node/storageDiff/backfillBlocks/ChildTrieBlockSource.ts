import type { AccountAddress } from "../blockStorageDiff";
import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream,
    type BlockListing
} from "./ABackfillBlockSource";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { retry } from "@/utils/retry";
import { getBytes, hexlify } from "ethers";

/**
 * Pure helpers of the Asset Hub backfill: where a contract's child trie lives
 * on the Substrate node and which blocks changed it. They read the node only;
 * they never write.
 */

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
export function reviveAccountInfoKey(address: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address))
        throw new Error("Not a 20-byte address");
    return "0x" + REVIVE_ACCOUNT_INFO_PREFIX + address.slice(2).toLowerCase();
}

/**
 * The child trie id (`ContractInfo.trie_id`) in a SCALE `AccountInfo` value (`AccountType::Contract`
 * is variant 0 and starts with the compact-length `trie_id`), or undefined for
 * an account that is not a contract.
 */
export function trieIdOf(accountInfo: string): string | undefined {
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
export function childStorageKey(trieId: string): string {
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
    rootsAt: (blocks: number[]) => Promise<(string | undefined)[]>,
    from: number,
    to: number
): Promise<number[]> {
    const changed: number[] = [];
    // The trie root read at each block number so far; undefined before the trie exists.
    const known = new Map<number, string | undefined>();
    const read = async (blocks: number[]) => {
        const fresh = [...new Set(blocks)].filter((n) => !known.has(n));
        if (fresh.length === 0) return;
        const roots = await rootsAt(fresh);
        fresh.forEach((n, i) => known.set(n, roots[i]));
    };
    await read([from, to]);
    let level: [number, number][] =
        known.get(from) === known.get(to) ? [] : [[from, to]];
    while (level.length > 0) {
        const splits = level.filter(([low, high]) => high - low > 1);
        for (const [, high] of level.filter(([a, b]) => b - a === 1))
            changed.push(high);
        await read(splits.map(([low, high]) => Math.floor((low + high) / 2)));
        level = splits.flatMap(([low, high]) => {
            const middle = Math.floor((low + high) / 2);
            const halves: [number, number][] = [];
            if (known.get(low) !== known.get(middle))
                halves.push([low, middle]);
            if (known.get(middle) !== known.get(high))
                halves.push([middle, high]);
            return halves;
        });
    }
    return changed.sort((a, b) => a - b);
}

/** Child trie keys asked for in one page. */
const KEYS_PAGE = 1000;
/** Retries of a block hash the Substrate node has not reached yet. */
const BLOCK_HASH_RETRIES = 4;
/** Delay before the first of those retries; each further one doubles it. */
const BLOCK_HASH_RETRY_DELAY_MS = 500;

/** The Substrate node has no block at a number yet: it lags the eth-rpc upstream. */
class BlockNotReachedError extends ChainMovedError {}

/**
 * Asset Hub: finds the blocks that changed a contract's storage by bisecting
 * the root of its child trie on the Substrate node, about log2(range) root
 * reads per change instead of one block read per block of the range. The
 * node must keep the state of the old blocks (an archive node). Only storage
 * changes are found; balance, nonce and code are read at the end anyway.
 */
export class ChildTrieBlockSource extends ABackfillBlockSource {
    private readonly assetHubUrl: string;
    // Reconnects by itself; opened on first use.
    private node?: RpcNodeProvider;
    // A contract keeps its child trie id for life.
    private readonly rootKeys = new Map<AccountAddress, string>();
    // Block hash reads in flight, by number: contracts counted at one block share the read.
    private readonly blockHashes = new Map<number, Promise<string>>();
    private closed = false;

    /** `assetHubUrl`: `ws://` or `wss://` Asset Hub Substrate node (not eth-rpc). */
    constructor(assetHubUrl: string) {
        super();
        this.assetHubUrl = assetHubUrl;
    }

    public async listBlocks(
        upstream: BackfillUpstream,
        address: AccountAddress,
        from: bigint,
        tip: { number: bigint; hash: string }
    ): Promise<BlockListing> {
        const read = this.reader(upstream);
        const tipHash = await this.hashAt(read, Number(tip.number));
        const rootKey = await this.rootKeyOf(read, address, tipHash);
        if (!rootKey) throw new Error("The address is not a contract");
        const changed = await findChangedBlocks(
            async (blocks) => {
                const hashes = await Promise.all(
                    blocks.map((n) => this.hashAt(read, n))
                );
                const roots = await Promise.all(
                    hashes.map((hash) =>
                        read("state_getStorage", [rootKey, hash])
                    )
                );
                return roots.map((root) =>
                    typeof root === "string" ? root : undefined
                );
            },
            Number(from) - 1,
            Number(tip.number)
        );
        // the range was one chain only if the tip is still the same block
        const again = await this.hashAt(read, Number(tip.number));
        if (again !== tipHash)
            throw new ChainMovedError("The chain moved during the bisection");
        return { numbers: changed.map(BigInt) };
    }

    public async countStorageEntries(
        upstream: BackfillUpstream,
        address: AccountAddress,
        at: { number: bigint }
    ): Promise<number> {
        const read = this.reader(upstream);
        const hash = await this.blockHashOf(read, Number(at.number));
        const rootKey = await this.rootKeyOf(read, address, hash);
        // an account without a child trie holds no entries
        if (!rootKey) return 0;
        let count = 0;
        let last: unknown = null;
        for (;;) {
            const page = (await read("childstate_getKeysPaged", [
                rootKey,
                "0x",
                KEYS_PAGE,
                last,
                hash
            ])) as string[];
            count += page.length;
            if (page.length < KEYS_PAGE) return count;
            last = page[page.length - 1];
        }
    }

    public close(): void {
        this.closed = true;
        this.node?.destroy();
    }

    /** One request to the Substrate node, through `upstream`'s limit. */
    private reader(
        upstream: BackfillUpstream
    ): (method: string, params: unknown[]) => Promise<unknown> {
        if (this.closed) throw new Error("Backfill block source is closed");
        this.node ??= new RpcNodeProvider(
            this.assetHubUrl,
            upstream.logger,
            {},
            { ethereum: false }
        );
        const node = this.node;
        return (method, params) => upstream.request(method, params, node);
    }

    /**
     * The key naming the contract's child trie at block `hash`; undefined for
     * an account that is not a contract there.
     */
    private async rootKeyOf(
        read: (method: string, params: unknown[]) => Promise<unknown>,
        address: AccountAddress,
        hash: string
    ): Promise<string | undefined> {
        const known = this.rootKeys.get(address);
        if (known) return known;
        const info = await read("state_getStorage", [
            reviveAccountInfoKey(address),
            hash
        ]);
        const trieId = typeof info === "string" ? trieIdOf(info) : undefined;
        if (!trieId) return undefined;
        const key = childStorageKey(trieId);
        this.rootKeys.set(address, key);
        return key;
    }

    private blockHashOf(
        read: (method: string, params: unknown[]) => Promise<unknown>,
        number: number
    ): Promise<string> {
        let hash = this.blockHashes.get(number);
        if (!hash) {
            hash = this.hashAt(read, number);
            this.blockHashes.set(number, hash);
            // only reads in flight are shared: a reorg may change the hash later
            const forget = () => this.blockHashes.delete(number);
            hash.then(forget, forget);
        }
        return hash;
    }

    /**
     * The hash of block `number`. A node that has not reached the block
     * answers null, and a read with no block hash would be of its best block
     * instead, so the read is asked again; a node still behind after the
     * retries fails it with a chain move.
     */
    private async hashAt(
        read: (method: string, params: unknown[]) => Promise<unknown>,
        number: number
    ): Promise<string> {
        return await retry(
            async () => {
                const hash = await read("chain_getBlockHash", [number]);
                if (typeof hash !== "string")
                    throw new BlockNotReachedError(
                        `The Substrate node has no block ${number} yet`
                    );
                return hash;
            },
            {
                maxRetries: BLOCK_HASH_RETRIES,
                delayMs: BLOCK_HASH_RETRY_DELAY_MS,
                useExponentialBackoff: true,
                shouldRetry: (error) => error instanceof BlockNotReachedError
            }
        );
    }
}
