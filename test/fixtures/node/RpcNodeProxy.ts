// @spec-test-coverage-ignore: test-owned WebSocket proxy in front of the test node; executable evidence belongs to its calling test declarations
import { once } from "node:events";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/** A JSON-RPC method name, e.g. `eth_sendRawTransaction`. */
type JsonRpcMethod = string;

function readJsonRpcMethod(data: RawData): JsonRpcMethod | undefined {
    try {
        const message: unknown = JSON.parse(data.toString());
        if (
            typeof message === "object" &&
            message !== null &&
            "method" in message &&
            typeof message.method === "string"
        )
            return message.method;
    } catch {
        // not JSON: forwarded unread
    }
    return undefined;
}

/**
 * A WebSocket proxy in front of one RPC node, so a test can stand it in for
 * a separate node. `cut()` drops every socket through it and refuses new ones
 * until `restore()`. It only cuts sockets: the node's state and every other
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
    private isCut = false;

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

    restore(): void {
        this.isCut = false;
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
        client.on("message", (data, isBinary) => {
            const method = readJsonRpcMethod(data);
            if (method) this.forwardedMethods.push(method);
            if (method && this.swallowedMethods.has(method)) return;
            if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data, { binary: isBinary });
            else pending.push({ data, isBinary });
        });
        upstream.on("open", () => {
            for (const frame of pending.splice(0))
                upstream.send(frame.data, { binary: frame.isBinary });
        });
        upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN)
                client.send(data, { binary: isBinary });
        });
        client.on("close", end);
        client.on("error", end);
        upstream.on("close", end);
        upstream.on("error", end);
    }
}
