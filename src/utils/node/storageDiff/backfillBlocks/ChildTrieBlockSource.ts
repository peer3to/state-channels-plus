import {
    childStorageKey,
    findChangedBlocks,
    reviveAccountInfoKey,
    trieIdOf
} from "../assetHubStateCheck";
import type { AccountAddress } from "../blockStorageDiff";
import { UpstreamRpcClient } from "../UpstreamRpcClient";
import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream,
    type BlockListing
} from "./ABackfillBlockSource";

/** Reads sent in one batch to the Substrate node. */
const READ_BATCH = 200;

/**
 * Asset Hub: finds the blocks that changed a contract's storage by bisecting
 * the root of its child trie on the Substrate node, about log2(range) root
 * reads per change instead of one block read per block of the range. The
 * node must keep the state of the old blocks (an archive node). Only storage
 * changes are found; balance, nonce and code are read at the end anyway.
 */
export class ChildTrieBlockSource extends ABackfillBlockSource {
    private readonly assetHubUrl: string;
    private client?: Promise<UpstreamRpcClient>;
    private closed = false;

    /** `assetHubUrl`: `ws://` or `wss://` Asset Hub Substrate node (not eth-rpc). */
    constructor(assetHubUrl: string) {
        super();
        this.assetHubUrl = assetHubUrl;
    }

    public async listBlocks(
        _upstream: BackfillUpstream,
        address: AccountAddress,
        from: bigint,
        tip: { number: bigint; hash: string }
    ): Promise<BlockListing> {
        const node = await this.connect();
        const tipHash = await node.request("chain_getBlockHash", [
            Number(tip.number)
        ]);
        const info = await node.request("state_getStorage", [
            reviveAccountInfoKey(address),
            tipHash
        ]);
        const trieId = typeof info === "string" ? trieIdOf(info) : undefined;
        if (!trieId) throw new Error("The address is not a contract");
        const rootKey = childStorageKey(trieId);
        const found = await findChangedBlocks(
            async (blocks) => {
                const hashes = await this.inBatches(
                    node,
                    blocks.map((n) => ({
                        method: "chain_getBlockHash",
                        params: [n]
                    }))
                );
                const roots = await this.inBatches(
                    node,
                    hashes.map((hash) => ({
                        method: "state_getStorage",
                        params: [rootKey, hash]
                    }))
                );
                return roots.map((root) =>
                    typeof root === "string" ? root : undefined
                );
            },
            Number(from) - 1,
            Number(tip.number)
        );
        // the range was one chain only if the tip is still the same block
        const again = await node.request("chain_getBlockHash", [
            Number(tip.number)
        ]);
        if (again !== tipHash)
            throw new ChainMovedError("The chain moved during the bisection");
        return {
            numbers: found.changed.map(BigInt),
            blocks: Number(tip.number - from) + 1,
            blockReads: 0,
            rootReads: found.rootReads,
            // each root read is a hash batch and a root batch; two more for the tip
            roundTrips: found.roundTrips * 2 + 3
        };
    }

    public close(): void {
        this.closed = true;
        void this.client?.then((node) =>
            node.close(new Error("Backfill block source closed"))
        );
    }

    private connect(): Promise<UpstreamRpcClient> {
        if (this.closed) throw new Error("Backfill block source is closed");
        this.client ??= UpstreamRpcClient.connect(this.assetHubUrl, {
            // the next listing connects again
            onLost: () => {
                this.client = undefined;
            }
        });
        return this.client;
    }

    private async inBatches(
        node: UpstreamRpcClient,
        calls: { method: string; params: unknown[] }[]
    ): Promise<unknown[]> {
        const answers: unknown[] = [];
        for (let i = 0; i < calls.length; i += READ_BATCH)
            answers.push(
                ...(await Promise.all(
                    node.requestBatch(calls.slice(i, i + READ_BATCH))
                ))
            );
        return answers;
    }
}
