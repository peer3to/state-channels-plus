// @spec-test-coverage-ignore: test-owned WebSocket proxy in front of the test node; executable evidence belongs to its calling test declarations
import { once } from "node:events";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/** A JSON-RPC method name, e.g. `eth_sendRawTransaction`. */
type JsonRpcMethod = string;

/** A JSON-RPC request or response id. */
type JsonRpcId = number | string;

/** The method and id of a JSON-RPC request, or the id of a response. */
function readJsonRpcFrame(data: RawData): {
    method?: JsonRpcMethod;
    id?: JsonRpcId;
} {
    try {
        const message: unknown = JSON.parse(data.toString());
        if (typeof message !== "object" || message === null) return {};
        const method =
            "method" in message && typeof message.method === "string"
                ? message.method
                : undefined;
        const id =
            "id" in message &&
            (typeof message.id === "number" || typeof message.id === "string")
                ? message.id
                : undefined;
        return { method, id };
    } catch {
        // not JSON: forwarded unread
        return {};
    }
}

/**
 * A WebSocket proxy in front of one RPC node, so a test can stand it in for
 * a separate node. `cut()` drops every socket through it and refuses new ones
 * until `restore()`; `blackhole()` keeps sockets open but forwards nothing.
 * Per-method faults hold, swallow or fail requests, or swallow replies. It
 * acts only on the sockets through it: the node's state and every other
 * client of the node are untouched.
 */
export class RpcNodeProxy {
    /** JSON-RPC methods clients sent through this proxy, in order. */
    readonly forwardedMethods: JsonRpcMethod[] = [];
    private readonly server: WebSocketServer;
    private readonly upstreamUrl: string;
    /** Each client socket and its upstream socket to the node. */
    private readonly links = new Map<WebSocket, WebSocket>();
    /** Methods whose requests are recorded but never forwarded. */
    private readonly swallowedMethods = new Set<JsonRpcMethod>();
    /** Methods whose requests are forwarded but whose replies are dropped. */
    private readonly swallowedReplyMethods = new Set<JsonRpcMethod>();
    /** Ids of forwarded requests whose replies are dropped. */
    private readonly swallowedReplyIds = new Set<JsonRpcId>();
    /** Methods whose next request this proxy answers with an error. */
    private readonly failingMethods = new Set<JsonRpcMethod>();
    /** Methods whose requests wait here until their hold is released. */
    private readonly heldMethods = new Map<JsonRpcMethod, (() => void)[]>();
    private isCut = false;
    private isBlackholed = false;

    private constructor(server: WebSocketServer, upstreamUrl: string) {
        this.server = server;
        this.upstreamUrl = upstreamUrl;
        server.on("connection", (client) => this.link(client));
    }

    /** A proxy on a free local port to the node at `nodeUrl` (http or ws). */
    static async start(nodeUrl: string): Promise<RpcNodeProxy> {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        return new RpcNodeProxy(server, nodeUrl.replace(/^http/i, "ws"));
    }

    get url(): string {
        const address = this.server.address();
        if (!address || typeof address === "string")
            throw new Error("Expected the proxy's TCP address");
        return `ws://127.0.0.1:${address.port}`;
    }

    /** Drop every open socket and refuse new ones until {@link restore}. */
    cut(): void {
        this.isCut = true;
        for (const [client, upstream] of this.links) {
            client.terminate();
            upstream.terminate();
        }
        this.links.clear();
    }

    /**
     * Record `method`'s requests but never forward them, so a request stays
     * in flight on this proxy until the test cuts it.
     */
    swallowRequests(method: JsonRpcMethod): void {
        this.swallowedMethods.add(method);
    }

    /** Forward `method`'s requests but drop the node's replies to them. */
    swallowReplies(method: JsonRpcMethod): void {
        this.swallowedReplyMethods.add(method);
    }

    /** Answer the next `method` request with a JSON-RPC error, unforwarded. */
    failNextRequest(method: JsonRpcMethod): void {
        this.failingMethods.add(method);
    }

    /**
     * Keep `method`'s requests at the proxy until the returned release runs,
     * then forward them.
     */
    holdRequests(method: JsonRpcMethod): () => void {
        this.heldMethods.set(method, []);
        return () => {
            const held = this.heldMethods.get(method) ?? [];
            this.heldMethods.delete(method);
            for (const forward of held) forward();
        };
    }

    /** Keep every socket open but forward nothing in either direction. */
    blackhole(): void {
        this.isBlackholed = true;
    }

    /** Undo {@link cut} and {@link blackhole}. */
    restore(): void {
        this.isCut = false;
        this.isBlackholed = false;
    }

    async close(): Promise<void> {
        this.cut();
        await new Promise<void>((resolve) =>
            this.server.close(() => resolve())
        );
    }

    private link(client: WebSocket): void {
        if (this.isCut) {
            client.terminate();
            return;
        }
        const upstream = new WebSocket(this.upstreamUrl);
        this.links.set(client, upstream);
        // client frames sent before the node socket opened
        const pending: { data: RawData; isBinary: boolean }[] = [];
        const end = () => {
            this.links.delete(client);
            client.terminate();
            upstream.terminate();
        };
        const forward = (data: RawData, isBinary: boolean) => {
            if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data, { binary: isBinary });
            else pending.push({ data, isBinary });
        };
        client.on("message", (data, isBinary) => {
            if (this.isBlackholed) return;
            const { method, id } = readJsonRpcFrame(data);
            if (method) this.forwardedMethods.push(method);
            if (method && this.swallowedMethods.has(method)) return;
            if (method && id !== undefined && this.failingMethods.has(method)) {
                this.failingMethods.delete(method);
                client.send(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        id,
                        error: { code: -32005, message: "request failed" }
                    })
                );
                return;
            }
            if (
                method &&
                id !== undefined &&
                this.swallowedReplyMethods.has(method)
            )
                this.swallowedReplyIds.add(id);
            const held = method ? this.heldMethods.get(method) : undefined;
            if (held) held.push(() => forward(data, isBinary));
            else forward(data, isBinary);
        });
        upstream.on("open", () => {
            for (const frame of pending.splice(0))
                upstream.send(frame.data, { binary: frame.isBinary });
        });
        upstream.on("message", (data, isBinary) => {
            if (this.isBlackholed) return;
            const { method, id } = readJsonRpcFrame(data);
            if (!method && id !== undefined && this.swallowedReplyIds.has(id))
                return;
            if (client.readyState === WebSocket.OPEN)
                client.send(data, { binary: isBinary });
        });
        client.on("close", end);
        client.on("error", end);
        upstream.on("close", end);
        upstream.on("error", end);
    }
}
