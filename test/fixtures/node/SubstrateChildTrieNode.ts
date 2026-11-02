// @spec-test-coverage-ignore: scripted Substrate node staging; executable evidence belongs to its calling test declarations
import { reviveAccountInfoKey } from "@/utils/node/storageDiff/assetHubStateCheck";
import { WebSocketServer, type AddressInfo } from "ws";

/** The `Revive.AccountInfoOf` value Asset Hub held for a mainnet contract (a contract: variant 0, 32-byte trie id). */
export const RECORDED_ACCOUNT_INFO =
    "0x0080534cf48ba03bfd9aad907397c556b60630666df566b309489b078f1ea2462806df37580a5890e6391148efc9cbc03c58a4b737422ca66bb8a9ae1928f39bacb5406a0000a901000001e81fa200000000000000000000000001b5a3fa0100000000000000000000005084b5e80000000000000000000000000000000000000000";

/** Marks an answer the node gives as a method-not-found error. */
const METHOD_NOT_SERVED = Symbol("method not served");

/** What a Substrate node holds of one contract, as far as the reads of the child trie sources go. */
export type SubstrateContract = {
    address: string;
    /** Blocks after which the contract's child trie root changed. */
    changes: number[];
    /** First block the contract exists at. */
    deployed: number;
    /** Block number of the chain's tip; the node answers its hash by `tipHash`. */
    tipNumber: number;
    /** Block hash the node reports for the tip, per question. */
    tipHash: () => string;
    /** The account info the node holds; null for no account. */
    info: string | null;
    /** Entries in the child trie, or per block number. */
    entries: number | ((blockNumber: number) => number);
};

export type SubstrateNode = {
    url: string;
    /** Child trie root reads answered so far. */
    rootReads: () => number;
    /** Requests answered so far, by method. */
    requests: () => Record<string, number>;
    /** The block number of every key page asked for, in arrival order. */
    keyPageBlocks: () => number[];
    /** Holds the answers to key pages from now on until `release`. */
    holdKeyPages: () => { arrived: Promise<void>; release: () => void };
};

/**
 * A scripted Substrate node, in the shape of recorded Asset Hub answers,
 * serving the reads the child trie sources make about one contract. It stands
 * in for faults and sizes the recording does not hold (a trie that gains an
 * entry the history lacks, a million blocks, a moving tip); the real exchange
 * is replayed from RecordedAssetHubChildTrie.ts.
 */
export async function withSubstrateNode<T>(
    contract: SubstrateContract,
    use: (node: SubstrateNode) => Promise<T>
): Promise<T> {
    let rootReads = 0;
    const requests: Record<string, number> = {};
    const keyPageBlocks: number[] = [];
    // Key page answers waiting for a release, while a hold is on.
    let held: (() => void)[] | undefined;
    let onHeld: (() => void) | undefined;
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const keysAt = (blockNumber: number) => {
        const count =
            typeof contract.entries === "number"
                ? contract.entries
                : contract.entries(blockNumber);
        return Array.from(
            { length: count },
            (_, i) => "0x" + i.toString(16).padStart(64, "0")
        );
    };
    const answer = (method: string, params: unknown[]): unknown => {
        requests[method] = (requests[method] ?? 0) + 1;
        if (method === "chain_getBlockHash") {
            const number = params[0] as number;
            return number === contract.tipNumber
                ? contract.tipHash()
                : "0xblock" + number;
        }
        if (method === "state_getStorage") {
            if (params[0] === reviveAccountInfoKey(contract.address))
                return contract.info;
            rootReads++;
            const hash = String(params[1]);
            const number = hash.startsWith("0xblock")
                ? Number(hash.slice("0xblock".length))
                : contract.tipNumber;
            if (number < contract.deployed) return null;
            return (
                "0xroot" + contract.changes.filter((c) => c <= number).length
            );
        }
        if (method === "childstate_getKeysPaged") {
            const [, , count, last, hash] = params as [
                string,
                string,
                number,
                string | null,
                string
            ];
            const blockNumber = String(hash).startsWith("0xblock")
                ? Number(String(hash).slice("0xblock".length))
                : contract.tipNumber;
            keyPageBlocks.push(blockNumber);
            const keys = keysAt(blockNumber);
            const from = last === null ? 0 : keys.indexOf(last) + 1;
            return keys.slice(from, from + count);
        }
        // as a Substrate node answers a method it does not serve (the heartbeat's)
        return METHOD_NOT_SERVED;
    };
    server.on("connection", (socket) =>
        socket.on("message", (data) => {
            const call = JSON.parse(data.toString()) as {
                id: number;
                method: string;
                params: unknown[];
            };
            const result = answer(call.method, call.params);
            const send = () =>
                socket.send(
                    JSON.stringify(
                        result === METHOD_NOT_SERVED
                            ? {
                                  jsonrpc: "2.0",
                                  id: call.id,
                                  error: {
                                      code: -32601,
                                      message: "Method not found"
                                  }
                              }
                            : { jsonrpc: "2.0", id: call.id, result }
                    )
                );
            if (held && call.method === "childstate_getKeysPaged") {
                held.push(send);
                onHeld?.();
            } else send();
        })
    );
    try {
        const { port } = server.address() as AddressInfo;
        return await use({
            url: `ws://127.0.0.1:${port}`,
            rootReads: () => rootReads,
            requests: () => ({ ...requests }),
            keyPageBlocks: () => [...keyPageBlocks],
            holdKeyPages: () => {
                held = [];
                const arrived = new Promise<void>(
                    (resolve) => (onHeld = resolve)
                );
                return {
                    arrived,
                    release: () => {
                        const waiting = held ?? [];
                        held = undefined;
                        for (const send of waiting) send();
                    }
                };
            }
        });
    } finally {
        for (const client of server.clients) client.terminate();
        await new Promise((resolve) => server.close(resolve));
    }
}
