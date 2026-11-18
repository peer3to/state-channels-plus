// @spec-test-coverage-ignore: test-owned stand-in for a node's light client endpoints; executable evidence belongs to its calling test declarations
import { JsonRpcSocket } from "./JsonRpcSocket";
import {
    LIGHT_CLIENT_METHODS,
    type LightClientLog,
    type LightClientStorageBlock,
    type LightClientSubscription,
    type SubstrateHeaderJson
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import { sleep } from "@/utils";
import { blake2b } from "@noble/hashes/blake2b";
import { concat, dataLength, dataSlice, getBytes, hexlify } from "ethers";
import { once } from "node:events";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/** A JSON-RPC request or response id. */
type JsonRpcId = number | string;
/** The id this sidecar gives a light client subscription. */
type SubscriptionId = string;
/** A Substrate block hash, 0x-prefixed. */
type BlockHash = string;

/** One block's storage changes as `state_subscribeStorage` notifies them. */
type StorageChanges = {
    block: BlockHash;
    changes: [key: string, value: string | null][];
};

/** `twox128("EVM") ++ twox128("AccountStorages")`. */
const ACCOUNT_STORAGES_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42";
const SLOT_LENGTH = 32;
/** Frontier maps a block to its Ethereum block shortly after the import. */
const LOG_READ_ATTEMPTS = 20;
const LOG_READ_RETRY_MS = 50;

/** The trie key prefix of every storage slot of the contract at `address`. */
function contractStoragePrefix(address: string): string {
    const addressBytes = getBytes(address);
    return hexlify(
        concat([
            ACCOUNT_STORAGES_PREFIX,
            blake2b(addressBytes, { dkLen: 16 }),
            addressBytes
        ])
    );
}

/**
 * Stands in for the light client endpoints of a peer3 node until the node
 * serves them itself. It is a WebSocket proxy in front of one node: every
 * request passes through, `rpc_methods` also lists the light client methods,
 * and a light client subscription is served here. The pushed blocks come from
 * the node's wildcard storage subscription, so the node must allow unsafe RPC
 * methods on the port this sidecar connects to.
 */
export class LightClientSidecar {
    /** Blocks in which a followed contract wrote storage but emitted no log. */
    writesWithoutLog = 0;
    private readonly server: WebSocketServer;
    private readonly upstreamUrl: string;
    /** This sidecar's own socket to the node, for the storage feed and its reads. */
    private readonly feed: JsonRpcSocket;
    private readonly subscriptions = new Map<
        SubscriptionId,
        { client: WebSocket; subscription: LightClientSubscription }
    >();
    private nextSubscriptionId = 1;

    private constructor(
        server: WebSocketServer,
        upstreamUrl: string,
        feed: JsonRpcSocket
    ) {
        this.server = server;
        this.upstreamUrl = upstreamUrl;
        this.feed = feed;
        server.on("connection", (client) => this.link(client));
        feed.onNotification((method, params) => {
            if (method === "state_storage")
                void this.pushBlock(
                    (params as { result: StorageChanges }).result
                );
        });
    }

    /** A sidecar on a free local port in front of the node at `nodeUrl`. */
    static async start(nodeUrl: string): Promise<LightClientSidecar> {
        const upstreamUrl = nodeUrl.replace(/^http/i, "ws");
        const feed = await JsonRpcSocket.open(upstreamUrl);
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const sidecar = new LightClientSidecar(server, upstreamUrl, feed);
        await feed.request("state_subscribeStorage");
        return sidecar;
    }

    get url(): string {
        const address = this.server.address();
        if (!address || typeof address === "string")
            throw new Error("Expected the sidecar's TCP address");
        return `ws://127.0.0.1:${address.port}`;
    }

    async close(): Promise<void> {
        this.feed.close();
        for (const client of this.server.clients) client.terminate();
        await new Promise<void>((resolve) =>
            this.server.close(() => resolve())
        );
    }

    /** The contract's logs of the Ethereum block, once the node has mapped it. */
    private async readLogs(
        ethereumBlockHash: string,
        address: string
    ): Promise<LightClientLog[]> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.feed.request("eth_getLogs", [
                    { blockHash: ethereumBlockHash, address }
                ]);
            } catch (error) {
                if (attempt === LOG_READ_ATTEMPTS) throw error;
                await sleep(LOG_READ_RETRY_MS);
            }
        }
    }

    /** Pushes one imported block to every subscription a log of it matches. */
    private async pushBlock({ block, changes }: StorageChanges): Promise<void> {
        const followed = new Set(
            [...this.subscriptions.values()].map(
                ({ subscription }) => subscription.address
            )
        );
        if (followed.size === 0) return;
        const headerJson = await this.feed.request<SubstrateHeaderJson>(
            "chain_getHeader",
            [block]
        );
        // the genesis header carries no Ethereum block
        if (Number(headerJson.number) === 0) return;
        const ethereumBlockHash = new SubstrateHeader(
            headerJson
        ).ethereumBlockHash();
        for (const address of followed) {
            const prefix = contractStoragePrefix(address);
            const written = changes.filter(([key]) => key.startsWith(prefix));
            const logs = await this.readLogs(ethereumBlockHash, address);
            if (logs.length === 0) {
                if (written.length > 0) this.writesWithoutLog += 1;
                continue;
            }
            const proofNodes =
                written.length === 0
                    ? []
                    : (
                          await this.feed.request<{ proof: string[] }>(
                              "state_getReadProof",
                              [written.map(([key]) => key), block]
                          )
                      ).proof;
            const writes = written.map(([key, value]) => ({
                slot: dataSlice(key, dataLength(key) - SLOT_LENGTH),
                value
            }));
            for (const [id, { client, subscription }] of this.subscriptions) {
                if (subscription.address !== address) continue;
                const topics = new Set(subscription.topics);
                const matching = logs.filter((log) =>
                    log.topics.some((topic) => topics.has(topic))
                );
                if (matching.length === 0) continue;
                const result: LightClientStorageBlock = {
                    header: headerJson,
                    writes,
                    proofNodes,
                    logs: matching
                };
                if (client.readyState === WebSocket.OPEN)
                    client.send(
                        JSON.stringify({
                            jsonrpc: "2.0",
                            method: LIGHT_CLIENT_METHODS.notification,
                            params: { subscription: id, result }
                        })
                    );
            }
        }
    }

    /** Joins a client to its own node socket and serves its light client calls. */
    private link(client: WebSocket): void {
        const upstream = new WebSocket(this.upstreamUrl);
        // client frames sent before the node socket opened
        const pending: { data: RawData; isBinary: boolean }[] = [];
        /** Ids of the client's `rpc_methods` requests in flight. */
        const methodListIds = new Set<JsonRpcId>();
        const end = () => {
            for (const [id, entry] of this.subscriptions)
                if (entry.client === client) this.subscriptions.delete(id);
            client.terminate();
            upstream.terminate();
        };
        client.on("message", (data, isBinary) => {
            const request = JSON.parse(data.toString());
            const reply = (result: unknown) =>
                client.send(
                    JSON.stringify({ jsonrpc: "2.0", id: request.id, result })
                );
            if (request.method === LIGHT_CLIENT_METHODS.subscribe) {
                const [asked]: [LightClientSubscription] = request.params;
                const id = `0x${(this.nextSubscriptionId++).toString(16)}`;
                this.subscriptions.set(id, {
                    client,
                    subscription: {
                        address: asked.address.toLowerCase(),
                        topics: asked.topics.map((topic) => topic.toLowerCase())
                    }
                });
                reply(id);
                return;
            }
            if (request.method === LIGHT_CLIENT_METHODS.unsubscribe) {
                reply(this.subscriptions.delete(request.params[0]));
                return;
            }
            if (request.method === "rpc_methods") methodListIds.add(request.id);
            if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data, { binary: isBinary });
            else pending.push({ data, isBinary });
        });
        upstream.on("open", () => {
            for (const frame of pending.splice(0))
                upstream.send(frame.data, { binary: frame.isBinary });
        });
        upstream.on("message", (data, isBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;
            const message = JSON.parse(data.toString());
            if (message.result && methodListIds.delete(message.id)) {
                message.result.methods.push(
                    LIGHT_CLIENT_METHODS.subscribe,
                    LIGHT_CLIENT_METHODS.unsubscribe
                );
                client.send(JSON.stringify(message));
                return;
            }
            client.send(data, { binary: isBinary });
        });
        client.on("close", end);
        client.on("error", end);
        upstream.on("close", end);
        upstream.on("error", end);
    }
}
