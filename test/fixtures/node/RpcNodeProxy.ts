// @spec-test-coverage-ignore: test-owned WebSocket proxy in front of the test node; executable evidence belongs to its calling test declarations
import { once } from "node:events";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/** A JSON-RPC method name, e.g. `eth_sendRawTransaction`. */
type JsonRpcMethod = string;

/** A JSON-RPC request or response id. */
type JsonRpcId = number | string;

/** One request a client sent through the proxy. */
export type ForwardedRequest = { method: JsonRpcMethod; params: unknown };

/** The method, id and params of a JSON-RPC request, or the id of a response. */
function readJsonRpcFrame(data: RawData): {
    method?: JsonRpcMethod;
    id?: JsonRpcId;
    params?: unknown;
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
        const params = "params" in message ? message.params : undefined;
        return { method, id, params };
    } catch {
        // not JSON: forwarded unread
        return {};
    }
}

/** The [fromBlock, toBlock] of an eth_getLogs request, from its hex bounds. */
function logBounds(params: unknown): [number, number] | undefined {
    if (!Array.isArray(params)) return undefined;
    const [filter]: unknown[] = params;
    if (
        typeof filter !== "object" ||
        filter === null ||
        !("fromBlock" in filter) ||
        !("toBlock" in filter) ||
        typeof filter.fromBlock !== "string" ||
        typeof filter.toBlock !== "string"
    )
        return undefined;
    return [Number(filter.fromBlock), Number(filter.toBlock)];
}

/** The [fromBlock, toBlock] of each eth_getLogs among `requests`, in order. */
function toLogWindows(requests: ForwardedRequest[]): [number, number][] {
    return requests
        .filter((request) => request.method === "eth_getLogs")
        .map((request) => {
            const bounds = logBounds(request.params);
            if (!bounds) throw new Error("eth_getLogs without block bounds");
            return bounds;
        });
}

/** Blocks an eth_getLogs request spans; 0 without explicit bounds. */
function logSpan(params: unknown): number {
    const bounds = logBounds(params);
    return bounds ? bounds[1] - bounds[0] + 1 : 0;
}

/**
 * A WebSocket proxy in front of one RPC node, so a test can stand it in for
 * a separate node. `cut()` drops every socket through it and refuses new ones
 * until `restore()`; `blackhole()` keeps sockets open but forwards nothing.
 * Per-method faults hold, swallow or fail requests, or hold or swallow
 * replies. It acts only on the sockets through it: the node's state and
 * every other client of the node are untouched.
 */
export class RpcNodeProxy {
    /** JSON-RPC methods clients sent to this proxy, in order, forwarded or not. */
    readonly forwardedMethods: JsonRpcMethod[] = [];
    /** The requests behind {@link forwardedMethods}, with their params. */
    readonly forwardedRequests: ForwardedRequest[] = [];
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
    /** Method -> the replies to its requests waiting here until released. */
    private readonly heldReplyMethods = new Map<
        JsonRpcMethod,
        (() => void)[]
    >();
    /** Request id -> the held replies it joins when it is answered. */
    private readonly heldReplyIds = new Map<JsonRpcId, (() => void)[]>();
    /** Method -> how many of its next requests this proxy answers with an error. */
    private readonly failingMethods = new Map<JsonRpcMethod, number>();
    /** Method -> how many of its next requests pass before one fails. */
    private readonly delayedFailures = new Map<JsonRpcMethod, number>();
    /** Requests this proxy answered with an error, in order. */
    private readonly failedRequests: ForwardedRequest[] = [];
    /** Method -> the result this proxy answers its requests with, unforwarded. */
    private readonly answeredMethods = new Map<JsonRpcMethod, unknown>();
    /** Most blocks an eth_getLogs may span before this proxy rejects it. */
    private maxLogSpan?: number;
    /**
     * Method -> its requests waiting here until their hold is released, and
     * how many more of its requests the hold takes.
     */
    private readonly heldMethods = new Map<
        JsonRpcMethod,
        { forwards: (() => void)[]; remaining: number }
    >();
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
        this.failingMethods.set(method, 1);
    }

    /** Let `passing` `method` requests through, then fail the next one. */
    failRequestAfter(method: JsonRpcMethod, passing: number): void {
        this.delayedFailures.set(method, passing);
    }

    /** How many `method` requests this proxy answered with an error. */
    failedCount(method: JsonRpcMethod): number {
        return this.failedRequests.filter((failed) => failed.method === method)
            .length;
    }

    /** The [fromBlock, toBlock] of every eth_getLogs this proxy failed, in order. */
    failedLogWindows(): [number, number][] {
        return toLogWindows(this.failedRequests);
    }

    /** Answer every `method` request with an error until {@link stopFailingRequests}. */
    failRequests(method: JsonRpcMethod): void {
        this.failingMethods.set(method, Number.POSITIVE_INFINITY);
    }

    stopFailingRequests(method: JsonRpcMethod): void {
        this.failingMethods.delete(method);
    }

    /** Answer every `method` request with `result` itself, unforwarded. */
    answerRequests(method: JsonRpcMethod, result: unknown): void {
        this.answeredMethods.set(method, result);
    }

    /** Forward `method`'s requests to the node again after {@link answerRequests}. */
    stopAnsweringRequests(method: JsonRpcMethod): void {
        this.answeredMethods.delete(method);
    }

    /** Reject eth_getLogs requests spanning more than `maxSpan` blocks. */
    rejectLogSpansAbove(maxSpan: number): void {
        this.maxLogSpan = maxSpan;
    }

    /** The [fromBlock, toBlock] of every eth_getLogs request, in order. */
    forwardedLogWindows(): [number, number][] {
        return toLogWindows(this.forwardedRequests);
    }

    /** How many `method` requests clients sent through this proxy. */
    forwardedCount(method: JsonRpcMethod): number {
        return this.forwardedMethods.filter((sent) => sent === method).length;
    }

    /**
     * Keep the next `count` of `method`'s requests (every one when omitted)
     * at the proxy until the returned release runs, then forward them.
     */
    holdRequests(
        method: JsonRpcMethod,
        count = Number.POSITIVE_INFINITY
    ): () => void {
        const hold = { forwards: [] as (() => void)[], remaining: count };
        this.heldMethods.set(method, hold);
        return () => {
            if (this.heldMethods.get(method) === hold)
                this.heldMethods.delete(method);
            for (const forward of hold.forwards.splice(0)) forward();
        };
    }

    /**
     * Keep the node's replies to `method` at the proxy until the returned
     * release sends them; `heldReplies` counts the ones waiting.
     */
    holdReplies(method: JsonRpcMethod): {
        heldReplies: () => number;
        release: () => void;
    } {
        const sends: (() => void)[] = [];
        this.heldReplyMethods.set(method, sends);
        return {
            heldReplies: () => sends.length,
            release: () => {
                if (this.heldReplyMethods.get(method) === sends)
                    this.heldReplyMethods.delete(method);
                // replies still in flight pass straight through
                for (const [id, held] of this.heldReplyIds)
                    if (held === sends) this.heldReplyIds.delete(id);
                for (const send of sends.splice(0)) send();
            }
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
            const { method, id, params } = readJsonRpcFrame(data);
            if (method) {
                this.forwardedMethods.push(method);
                this.forwardedRequests.push({ method, params });
            }
            // recorded, then lost: the path to the node is dead
            if (this.isBlackholed) return;
            if (method && this.swallowedMethods.has(method)) return;
            const reply = (answer: object) =>
                client.send(JSON.stringify({ jsonrpc: "2.0", id, ...answer }));
            const passing = method
                ? this.delayedFailures.get(method)
                : undefined;
            if (method && id !== undefined && passing !== undefined) {
                if (passing === 0) {
                    this.delayedFailures.delete(method);
                    this.failingMethods.set(method, 1);
                } else this.delayedFailures.set(method, passing - 1);
            }
            const failures = method
                ? this.failingMethods.get(method)
                : undefined;
            if (method && id !== undefined && failures) {
                if (failures === 1) this.failingMethods.delete(method);
                else this.failingMethods.set(method, failures - 1);
                this.failedRequests.push({ method, params });
                reply({ error: { code: -32005, message: "request failed" } });
                return;
            }
            if (
                method &&
                id !== undefined &&
                this.answeredMethods.has(method)
            ) {
                reply({ result: this.answeredMethods.get(method) });
                return;
            }
            if (
                method === "eth_getLogs" &&
                id !== undefined &&
                this.maxLogSpan !== undefined &&
                logSpan(params) > this.maxLogSpan
            ) {
                reply({
                    error: { code: -32005, message: "block range too large" }
                });
                return;
            }
            if (
                method &&
                id !== undefined &&
                this.swallowedReplyMethods.has(method)
            )
                this.swallowedReplyIds.add(id);
            const heldReplies = method
                ? this.heldReplyMethods.get(method)
                : undefined;
            if (heldReplies && id !== undefined)
                this.heldReplyIds.set(id, heldReplies);
            const hold = method ? this.heldMethods.get(method) : undefined;
            if (hold && hold.remaining > 0) {
                hold.remaining -= 1;
                hold.forwards.push(() => forward(data, isBinary));
            } else forward(data, isBinary);
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
            const send = () => {
                if (client.readyState === WebSocket.OPEN)
                    client.send(data, { binary: isBinary });
            };
            const heldReplies =
                !method && id !== undefined
                    ? this.heldReplyIds.get(id)
                    : undefined;
            if (heldReplies && id !== undefined) {
                this.heldReplyIds.delete(id);
                heldReplies.push(send);
            } else send();
        });
        client.on("close", end);
        client.on("error", end);
        upstream.on("close", end);
        upstream.on("error", end);
    }
}
