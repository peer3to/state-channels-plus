import {
    childStorageKey,
    findChangedBlocks,
    reviveAccountInfoKey,
    trieIdOf
} from "../assetHubStateCheck";
import type { AccountAddress } from "../blockStorageDiff";
import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream,
    type BlockListing
} from "./ABackfillBlockSource";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";

/** Child trie keys asked for in one page. */
const KEYS_PAGE = 1000;

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
    private readonly blockHashes = new Map<number, Promise<unknown>>();
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
        const tipHash = await read("chain_getBlockHash", [Number(tip.number)]);
        const rootKey = await this.rootKeyOf(read, address, tipHash);
        const found = await findChangedBlocks(
            async (blocks) => {
                const hashes = await Promise.all(
                    blocks.map((n) => read("chain_getBlockHash", [n]))
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
        const again = await read("chain_getBlockHash", [Number(tip.number)]);
        if (again !== tipHash)
            throw new ChainMovedError("The chain moved during the bisection");
        return {
            numbers: found.changed.map(BigInt),
            blocks: Number(tip.number - from) + 1,
            blockReads: 0,
            rootReads: found.rootReads
        };
    }

    public async countStorageEntries(
        upstream: BackfillUpstream,
        address: AccountAddress,
        at: { number: bigint }
    ): Promise<number> {
        const read = this.reader(upstream);
        const hash = await this.blockHashOf(read, Number(at.number));
        const rootKey = await this.rootKeyOf(read, address, hash);
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
        return (method, params) => upstream.requestOn(node, method, params);
    }

    /** The key naming the contract's child trie at block `hash`. */
    private async rootKeyOf(
        read: (method: string, params: unknown[]) => Promise<unknown>,
        address: AccountAddress,
        hash: unknown
    ): Promise<string> {
        const known = this.rootKeys.get(address);
        if (known) return known;
        const info = await read("state_getStorage", [
            reviveAccountInfoKey(address),
            hash
        ]);
        const trieId = typeof info === "string" ? trieIdOf(info) : undefined;
        if (!trieId) throw new Error("The address is not a contract");
        const key = childStorageKey(trieId);
        this.rootKeys.set(address, key);
        return key;
    }

    private blockHashOf(
        read: (method: string, params: unknown[]) => Promise<unknown>,
        number: number
    ): Promise<unknown> {
        let hash = this.blockHashes.get(number);
        if (!hash) {
            hash = read("chain_getBlockHash", [number]);
            this.blockHashes.set(number, hash);
            // only reads in flight are shared: a reorg may change the hash later
            const forget = () => this.blockHashes.delete(number);
            hash.then(forget, forget);
        }
        return hash;
    }
}
