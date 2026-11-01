// @spec-test-coverage-ignore: relay and Asset Hub staging; executable evidence belongs to its calling test declarations
import { readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

/** One recorded Paras::Heads announcement and the Asset Hub read it leads to. */
export type RecordedInclusion = {
    relayBlock: string;
    relayNotification: { block: string; changes: [string, string][] };
    number: number;
    substrateHash: string;
    storageKey: string;
    ethHashFromRevive: string;
    ethHashFromEthRpc: string;
};

export type RecordedInclusions = {
    paraId: number;
    fixtures: RecordedInclusion[];
    otherParaHeadKeys: Record<string, string>;
};

/**
 * Real values recorded from the Polkadot relay chain and Asset Hub (see the
 * JSON's `note` and `sources`).
 */
export const recorded: RecordedInclusions = JSON.parse(
    readFileSync(join(__dirname, "assetHubInclusion.recorded.json"), "utf8")
);

type Answer = (method: string, params: unknown[]) => unknown;

/** A WebSocket JSON-RPC server that answers like one recorded node. */
class RecordedNode {
    protected readonly server: WebSocketServer;
    protected readonly sockets = new Set<WebSocket>();
    private readonly answer: Answer;
    private readonly seen: string[] = [];
    // Params of every request seen, in arrival order.
    private readonly seenParams: { method: string; params: unknown[] }[] = [];
    private connections = 0;
    private readonly reachWaiters: {
        method: string;
        count: number;
        resolve: () => void;
    }[] = [];

    protected constructor(server: WebSocketServer, answer: Answer) {
        this.server = server;
        this.answer = answer;
        server.on("connection", (socket) => {
            this.connections++;
            this.sockets.add(socket);
            socket.on("close", () => this.sockets.delete(socket));
            socket.on("message", (data) => {
                const { id, method, params } = JSON.parse(data.toString());
                this.seen.push(method);
                this.seenParams.push({ method, params });
                for (const waiter of [...this.reachWaiters]) {
                    if (this.requestCount(waiter.method) >= waiter.count) {
                        this.reachWaiters.splice(
                            this.reachWaiters.indexOf(waiter),
                            1
                        );
                        waiter.resolve();
                    }
                }
                socket.send(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        id,
                        result: this.answer(method, params)
                    })
                );
                this.afterAnswer(socket, method);
            });
        });
    }

    protected static async listen(): Promise<WebSocketServer> {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        return server;
    }

    get url(): string {
        return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    get connectionCount(): number {
        return this.connections;
    }

    requestCount(method: string): number {
        return this.seen.filter((seen) => seen === method).length;
    }

    /** Params of every `method` request seen, in arrival order. */
    paramsOf(method: string): unknown[][] {
        return this.seenParams
            .filter((seen) => seen.method === method)
            .map((seen) => seen.params);
    }

    /** Resolves once `count` `method` requests arrived in all. */
    requestsReached(method: string, count: number): Promise<void> {
        if (this.requestCount(method) >= count) return Promise.resolve();
        return new Promise((resolve) =>
            this.reachWaiters.push({ method, count, resolve })
        );
    }

    /** Cuts every open connection. */
    disconnect(): void {
        for (const socket of this.sockets) socket.terminate();
    }

    async close(): Promise<void> {
        this.disconnect();
        await new Promise<void>((resolve) =>
            this.server.close(() => resolve())
        );
    }

    // Hook for the subclass that pushes after a subscription answer.
    protected afterAnswer(_socket: WebSocket, _method: string): void {}
}

/**
 * The relay chain: `state_subscribeStorage` answers with a subscription id
 * and announces the newest recorded head at once, as the real node does.
 */
export class RecordedRelayNode extends RecordedNode {
    private announced = 0;
    private readonly subscribed = new Set<WebSocket>();
    private readonly headKey?: string;

    private constructor(server: WebSocketServer, headKey?: string) {
        super(server, (method) => {
            if (method !== "state_subscribeStorage") {
                throw new Error(`Unexpected relay request ${method}`);
            }
            return "recorded-subscription";
        });
        this.headKey = headKey;
    }

    /**
     * `headKey` names the `Paras::Heads` key the announcements carry, for a
     * service that follows another para id than the recorded one; the head
     * value is the recorded one.
     */
    static async start(headKey?: string): Promise<RecordedRelayNode> {
        return new RecordedRelayNode(await RecordedNode.listen(), headKey);
    }

    /** Announces recorded inclusion `index` to every subscriber. */
    announce(index: number): void {
        this.announced = index;
        for (const socket of this.subscribed) this.notify(socket);
    }

    // Hook override: the newest announcement follows every new subscription.
    protected override afterAnswer(socket: WebSocket, method: string): void {
        if (method !== "state_subscribeStorage") return;
        this.subscribed.add(socket);
        socket.on("close", () => this.subscribed.delete(socket));
        this.notify(socket);
    }

    private notify(socket: WebSocket): void {
        const notification =
            recorded.fixtures[this.announced].relayNotification;
        const result = this.headKey
            ? {
                  ...notification,
                  changes: notification.changes.map(([, value]) => [
                      this.headKey,
                      value
                  ])
              }
            : notification;
        socket.send(
            JSON.stringify({
                jsonrpc: "2.0",
                method: "state_storage",
                params: {
                    subscription: "recorded-subscription",
                    result
                }
            })
        );
    }
}

/** Asset Hub: answers `state_getStorage` with the recorded `Revive::BlockHash`. */
export class RecordedAssetHubNode extends RecordedNode {
    private constructor(server: WebSocketServer) {
        super(server, (method, params) => {
            if (method !== "state_getStorage") {
                throw new Error(`Unexpected Asset Hub request ${method}`);
            }
            const [key, at] = params as [string, string];
            const match = recorded.fixtures.find(
                (fixture) =>
                    fixture.storageKey === key && fixture.substrateHash === at
            );
            return match ? match.ethHashFromRevive : null;
        });
    }

    static async start(): Promise<RecordedAssetHubNode> {
        return new RecordedAssetHubNode(await RecordedNode.listen());
    }
}
