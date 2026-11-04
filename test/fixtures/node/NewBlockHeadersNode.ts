// @spec-test-coverage-ignore: replay of recorded Asset Hub frames, the node for the head subscription cases; declarations live in NodeHeadSubscription.test.ts and the cases of the proxies that use asNewBlockHeadersNode
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createLogger } from "@/utils/logging";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type RawData, WebSocket, WebSocketServer } from "ws";

type Frame = { jsonrpc: "2.0"; id?: number } & Record<string, unknown>;

/**
 * What Asset Hub's eth-rpc (endpoint, block and date in the JSON) answered,
 * recorded with read-only calls.
 */
const recorded: {
    block: number;
    chainId: Frame;
    newHeadsRefusal: Frame;
    newBlockHeadersAck: Frame & { result: string };
    headerPush: Frame;
} = JSON.parse(
    readFileSync(
        join(__dirname, "assetHubNewBlockHeaders.recorded.json"),
        "utf8"
    )
);

/** The block of the header the node pushes. */
export const PUSHED_BLOCK = BigInt(recorded.block);

/** The id the node hands out for a newBlockHeaders subscription. */
export const NEW_BLOCK_HEADERS_SUBSCRIPTION =
    recorded.newBlockHeadersAck.result;

/**
 * What a relay in front of a node that offers newHeads (anvil) does with a
 * client's request so the node looks like Asset Hub's eth-rpc: newHeads is
 * refused with the recorded answer, and newBlockHeaders is forwarded as
 * newHeads, whose pushes carry the same header. Undefined: the request
 * passes unchanged.
 */
export function asNewBlockHeadersNode(request: {
    method?: string;
    id?: unknown;
    params?: unknown;
}): { answer: string } | { forward: string } | undefined {
    if (request.method !== "eth_subscribe" || !Array.isArray(request.params))
        return undefined;
    const [kind, ...rest] = request.params as unknown[];
    if (kind === "newHeads")
        return {
            answer: JSON.stringify({
                ...recorded.newHeadsRefusal,
                id: request.id
            })
        };
    if (kind === "newBlockHeaders")
        return {
            forward: JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                method: "eth_subscribe",
                params: ["newHeads", ...rest]
            })
        };
    return undefined;
}

/**
 * A WebSocket node that replays Asset Hub's eth-rpc for subscriptions: it
 * refuses `eth_subscribe ["newHeads"]` and accepts `["newBlockHeaders"]` with
 * the recorded answers, and pushes the recorded header on demand. It answers
 * `eth_chainId` with the recorded answer and nothing else.
 */
export class NewBlockHeadersNode {
    /** The subscription kinds each `eth_subscribe` asked for, in order. */
    readonly subscribeKinds: string[] = [];
    /** The subscription ids each `eth_unsubscribe` named, in order. */
    readonly unsubscribedIds: string[] = [];
    private readonly server: WebSocketServer;
    private readonly subscriptions = new Set<WebSocket>();
    /** False: the node's refusal of newHeads does not name newBlockHeaders. */
    private readonly offersNewBlockHeaders: boolean;

    private constructor(
        server: WebSocketServer,
        offersNewBlockHeaders: boolean
    ) {
        this.server = server;
        this.offersNewBlockHeaders = offersNewBlockHeaders;
        server.on("connection", (socket) => {
            socket.on("message", (data) => this.onMessage(socket, data));
            socket.on("close", () => this.subscriptions.delete(socket));
        });
    }

    static async start(
        offersNewBlockHeaders = true
    ): Promise<NewBlockHeadersNode> {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        return new NewBlockHeadersNode(server, offersNewBlockHeaders);
    }

    get url(): string {
        const address = this.server.address();
        if (!address || typeof address === "string")
            throw new Error("Expected the node's TCP address");
        return `ws://127.0.0.1:${address.port}`;
    }

    /** Sockets that hold a head subscription now. */
    get subscribedSockets(): number {
        return this.subscriptions.size;
    }

    /** Pushes the recorded header to every subscribed socket. */
    pushHeader(): void {
        for (const socket of this.subscriptions)
            socket.send(JSON.stringify(recorded.headerPush));
    }

    /** Closes every open socket; the node keeps listening. */
    dropSockets(): void {
        for (const socket of this.server.clients) socket.terminate();
    }

    async close(): Promise<void> {
        this.dropSockets();
        await new Promise<void>((resolve) =>
            this.server.close(() => resolve())
        );
    }

    private onMessage(socket: WebSocket, data: RawData): void {
        const request = JSON.parse(data.toString()) as {
            id: number;
            method: string;
            params: unknown[];
        };
        // the recorded answer under the id of this request
        const answer = (recordedAnswer: Frame) =>
            socket.send(JSON.stringify({ ...recordedAnswer, id: request.id }));
        if (request.method === "eth_chainId") return answer(recorded.chainId);
        if (request.method === "eth_unsubscribe") {
            // Not recorded: the node ends the subscription it handed out
            const id = String(request.params[0]);
            this.unsubscribedIds.push(id);
            const known = id === NEW_BLOCK_HEADERS_SUBSCRIPTION;
            if (known) this.subscriptions.delete(socket);
            return socket.send(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: request.id,
                    result: known
                })
            );
        }
        if (request.method !== "eth_subscribe")
            // Fault injection, not recorded: any other method is unknown to this node
            return socket.send(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: request.id,
                    error: { code: -32601, message: "method not found" }
                })
            );
        const kind = String(request.params[0]);
        this.subscribeKinds.push(kind);
        if (!this.offersNewBlockHeaders)
            // Fault injection, not recorded: a refusal that offers no other kind
            return socket.send(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: request.id,
                    error: { code: -32602, message: "Invalid params" }
                })
            );
        if (kind !== "newBlockHeaders") return answer(recorded.newHeadsRefusal);
        this.subscriptions.add(socket);
        answer(recorded.newBlockHeadersAck);
    }
}

/**
 * Runs `use` with a provider over one {@link NewBlockHeadersNode}, which
 * offers newBlockHeaders in its refusal of newHeads unless
 * `offersNewBlockHeaders` is false; all of it ends in `finally`.
 */
export async function withNewBlockHeadersProvider(
    offersNewBlockHeaders: boolean,
    use: (
        node: NewBlockHeadersNode,
        provider: MultiRpcProvider,
        rpcNode: RpcNodeProvider
    ) => Promise<void>
): Promise<void> {
    const node = await NewBlockHeadersNode.start(offersNewBlockHeaders);
    const logger = createLogger(
        {},
        {},
        { level: "error", attachErrorListener: false }
    );
    const rpcNode = new RpcNodeProvider(node.url, logger);
    const provider = new MultiRpcProvider([rpcNode], logger);
    try {
        await rpcNode.firstAttempt;
        await use(node, provider, rpcNode);
    } finally {
        provider.destroy();
        await node.close();
        logger.dispose();
    }
}
