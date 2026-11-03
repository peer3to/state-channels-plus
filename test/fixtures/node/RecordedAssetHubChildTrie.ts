// @spec-test-coverage-ignore: recorded Asset Hub staging; executable evidence belongs to its calling test declarations
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, type AddressInfo } from "ws";

type RecordedCall = { method: string; params: unknown[]; result: unknown };

/** Reads of one mainnet contract's child trie, recorded from Asset Hub. */
export type RecordedChildTrie = {
    recordedAt: string;
    endpoint: string;
    note: string;
    address: string;
    tip: number;
    from: number;
    /** Blocks of `from`..`tip` that carry a transaction to the contract. */
    changedBlocks: number[];
    /** First block after the last change. */
    afterLastChange: number;
    /** Entries of the contract's child trie at `tip`. */
    entries: number;
    calls: RecordedCall[];
};

/** Real answers recorded from the Asset Hub Substrate node (see the JSON's `note`). */
export const recordedChildTrie: RecordedChildTrie = JSON.parse(
    readFileSync(join(__dirname, "assetHubChildTrie.recorded.json"), "utf8")
);

/** What a node replaying the recording was asked beyond it. */
export type ReplayedNode = {
    url: string;
    /** Requests the recording holds no answer for; each got an error answer. */
    unrecorded: () => string[];
};

/**
 * A WebSocket JSON-RPC node that answers each request with the recorded answer
 * to the same method and params, and with an error answer to any other.
 */
export async function withRecordedChildTrieNode<T>(
    use: (node: ReplayedNode) => Promise<T>
): Promise<T> {
    const answers = new Map<string, unknown>(
        recordedChildTrie.calls.map((call) => [
            JSON.stringify([call.method, call.params]),
            call.result
        ])
    );
    const unrecorded: string[] = [];
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const reply = (call: { id: number; method: string; params: unknown[] }) => {
        // the provider's liveness probe: a Substrate node does not serve it
        if (call.method === "eth_blockNumber")
            return {
                jsonrpc: "2.0",
                id: call.id,
                error: { code: -32601, message: "Method not found" }
            };
        const key = JSON.stringify([call.method, call.params]);
        if (answers.has(key))
            return { jsonrpc: "2.0", id: call.id, result: answers.get(key) };
        unrecorded.push(key);
        return {
            jsonrpc: "2.0",
            id: call.id,
            error: { code: -32000, message: "Not in the recording" }
        };
    };
    server.on("connection", (socket) =>
        socket.on("message", (data) => {
            socket.send(JSON.stringify(reply(JSON.parse(data.toString()))));
        })
    );
    try {
        const { port } = server.address() as AddressInfo;
        return await use({
            url: `ws://127.0.0.1:${port}`,
            unrecorded: () => [...unrecorded]
        });
    } finally {
        for (const client of server.clients) client.terminate();
        await new Promise((resolve) => server.close(resolve));
    }
}
