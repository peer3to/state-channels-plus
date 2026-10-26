// @spec-test-coverage-ignore: upstream fault staging; executable evidence belongs to its calling test declarations
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

/** JSON-RPC method name of a request the service sent upstream. */
type UpstreamMethod = string;

type RelayedRequest = {
    id: unknown;
    method: UpstreamMethod;
    params: unknown[];
};

/** A request held at the relay until the test releases it. */
export type HeldRequest = {
    /** Resolves when the matching request reaches the relay and is held. */
    arrived: Promise<void>;
    /** Forwards the held request to the node. */
    release: () => void;
};

type Hold = {
    method: UpstreamMethod;
    firstParam: unknown;
    onArrive: () => void;
    forward?: () => void;
};

/**
 * Relays every WebSocket frame between the service and the real node, so a
 * test can hold a real request, answer one with an error frame on the actual
 * connection, or cut the connection. It never answers a request itself
 * except with an injected error.
 */
export class UpstreamRelay {
    private readonly server: WebSocketServer;
    private readonly target: string;
    private readonly sockets = new Set<WebSocket>();
    // Requests seen per method, held or failed ones included.
    private readonly seen = new Map<UpstreamMethod, number>();
    private hold?: Hold;
    private failing?: { method: UpstreamMethod; remaining: number };

    private constructor(server: WebSocketServer, target: string) {
        this.server = server;
        this.target = target;
        server.on("connection", (client) => this.relay(client));
    }

    static async start(target: string): Promise<UpstreamRelay> {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        return new UpstreamRelay(server, target);
    }

    get url(): string {
        return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    /** How many `method` requests reached the relay. */
    requestCount(method: UpstreamMethod): number {
        return this.seen.get(method) ?? 0;
    }

    /** Holds the next `method` request whose first param is `firstParam`. */
    holdNext(method: UpstreamMethod, firstParam: unknown): HeldRequest {
        let onArrive!: () => void;
        const arrived = new Promise<void>((resolve) => (onArrive = resolve));
        const hold: Hold = { method, firstParam, onArrive };
        this.hold = hold;
        return {
            arrived,
            release: () => {
                if (!hold.forward) throw new Error("Nothing is held yet");
                hold.forward();
            }
        };
    }

    /** Answers the next `count` `method` requests with an error frame. */
    failNext(method: UpstreamMethod, count: number): void {
        this.failing = { method, remaining: count };
    }

    /** Cuts every relayed connection. */
    disconnect(): void {
        for (const socket of this.sockets) socket.terminate();
    }

    async close(): Promise<void> {
        this.disconnect();
        await new Promise<void>((resolve) =>
            this.server.close(() => resolve())
        );
    }

    private relay(client: WebSocket): void {
        const upstream = new WebSocket(this.target);
        this.sockets.add(client);
        this.sockets.add(upstream);
        const toUpstream: string[] = [];
        upstream.on("open", () => {
            for (const frame of toUpstream.splice(0)) upstream.send(frame);
        });
        const forward = (frame: string) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
            else toUpstream.push(frame);
        };
        upstream.on("message", (data) => {
            if (client.readyState === WebSocket.OPEN)
                client.send(data.toString());
        });
        client.on("message", (data) => {
            const frame = data.toString();
            const request = JSON.parse(frame) as RelayedRequest;
            this.seen.set(
                request.method,
                this.requestCount(request.method) + 1
            );
            if (this.failing?.method === request.method) {
                if (--this.failing.remaining === 0) this.failing = undefined;
                client.send(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        id: request.id,
                        error: { code: -32000, message: "relay fault" }
                    })
                );
                return;
            }
            const hold = this.hold;
            if (
                hold &&
                !hold.forward &&
                hold.method === request.method &&
                request.params[0] === hold.firstParam
            ) {
                this.hold = undefined;
                hold.forward = () => forward(frame);
                hold.onArrive();
                return;
            }
            forward(frame);
        });
        const cut = () => {
            client.terminate();
            upstream.terminate();
        };
        client.on("close", cut);
        upstream.on("close", cut);
        client.on("error", cut);
        upstream.on("error", cut);
    }
}
