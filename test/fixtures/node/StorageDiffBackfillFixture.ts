// @spec-test-coverage-ignore: backfill and child trie source staging; executable evidence belongs to its calling test declarations
import { StorageDiffClient } from "./StorageDiffClient";
import { deploySlotWriter, writeSlot } from "./StorageDiffContracts";
import {
    withStorageDiffUpstream,
    type StorageDiffUpstream
} from "./StorageDiffSession";
import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateContract,
    type SubstrateNode
} from "./SubstrateChildTrieNode";
import { createLogger, sleep } from "@/utils";
import type { BackfillUpstream } from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import type { JsonRpcProvider, JsonRpcSigner } from "ethers";

/** The contract address the child trie source cases read. */
export const CHILD_TRIE_ADDRESS = "0x99ee73298423dcf5da3059a5e48bda20bfbcd01b";
/** The tip the child trie source cases read up to. */
export const CHILD_TRIE_TIP = { number: 1_000_000n, hash: "0xeth" };

/** A chain shape for the recorded contract, with the tip's hash per question. */
export function chain(
    overrides: Partial<SubstrateContract> = {}
): SubstrateContract {
    return {
        address: CHILD_TRIE_ADDRESS,
        changes: [],
        deployed: 0,
        tipNumber: Number(CHILD_TRIE_TIP.number),
        tipHash: () => "0xtip",
        info: RECORDED_ACCOUNT_INFO,
        entries: 0,
        ...overrides
    };
}

/** Reads the Substrate node straight; the source never asks the eth upstream. */
export const NO_UPSTREAM: BackfillUpstream = {
    request: (method, params, node) =>
        node
            ? node.send(method, params)
            : Promise.reject(new Error("The eth upstream is not used")),
    logger: createLogger({}, { component: "ChildTrieBlockSourceTest" })
};

/** Runs `use` with a source on a node of `contract`, closed in `finally`. */
export async function withSource<T>(
    contract: SubstrateContract,
    use: (source: ChildTrieBlockSource, reads: SubstrateNode) => Promise<T>
): Promise<T> {
    return await withSubstrateNode(contract, async (node) => {
        const source = new ChildTrieBlockSource(node.url);
        try {
            return await use(source, node);
        } finally {
            source.close();
        }
    });
}

/** What `backfillWith` hands its test. */
export type ChildTrieBackfill = {
    node: SubstrateNode;
    session: StorageDiffUpstream;
    writer: string;
    client: StorageDiffClient;
    head: { number: number; hash: string };
};

/**
 * A node of the writer's chain with `entries` child trie entries.
 * `contract` changes the scripted node's chain shape.
 */
export async function backfillWith(
    entries: number | ((blockNumber: number) => number),
    run: (context: ChildTrieBackfill) => Promise<void>,
    contract: Partial<SubstrateContract> = {}
): Promise<void> {
    await withStorageDiffUpstream(async (session) => {
        const { provider, signer, start } = session;
        const writer = await deploySlotWriter(signer);
        await writeSlot(signer, writer, 1, 5n);
        await writeSlot(signer, writer, 2, 7n);
        const block = (await provider.getBlock("latest"))!;
        await withSubstrateNode(
            {
                address: writer,
                changes: [block.number - 2, block.number - 1, block.number],
                deployed: block.number - 2,
                tipNumber: block.number,
                tipHash: () => "0xtip",
                info: RECORDED_ACCOUNT_INFO,
                entries,
                ...contract
            },
            async (node) => {
                const service = await start({
                    backfillBlocks: new ChildTrieBlockSource(node.url)
                });
                const client = await StorageDiffClient.connect(service.url);
                try {
                    await run({
                        node,
                        session,
                        writer,
                        client,
                        head: { number: block.number, hash: block.hash! }
                    });
                } finally {
                    client.close();
                }
            }
        );
    });
}

export async function backfilled(session: StorageDiffUpstream): Promise<void> {
    while (session.backfills.length === 0) await sleep(20);
}

// the chain holds one more entry from the block of the write on
export const WRITE_ADDS_ENTRY = (firstBlock: () => number) => (n: number) =>
    n >= firstBlock() ? 3 : 2;

/** Waits until `done` holds, up to `boundMs`. */
export async function until(
    done: () => boolean,
    boundMs = 3_000
): Promise<boolean> {
    for (let i = 0; i < boundMs / 20 && !done(); i++) await sleep(20);
    return done();
}

/** Mines `empty` blocks, deploys a writer and writes two slots; returns the deploy block and the head. */
export async function deployedAfter(
    provider: JsonRpcProvider,
    signer: JsonRpcSigner,
    empty: number
): Promise<{ writer: string; deployed: number; head: number }> {
    for (let i = 0; i < empty; i++) await provider.send("evm_mine", []);
    const writer = await deploySlotWriter(signer);
    // read uncached: ethers keeps the block number for a polling interval
    const head = async () => Number(await provider.send("eth_blockNumber", []));
    const deployed = await head();
    await writeSlot(signer, writer, 1, 5n);
    await writeSlot(signer, writer, 2, 6n);
    return { writer, deployed, head: await head() };
}

/** The block of a backfill's code probe: a quantity, where other reads name a hash. */
export function probedBlock(params: unknown[]): number | undefined {
    return typeof params[1] === "string" ? Number(params[1]) : undefined;
}
