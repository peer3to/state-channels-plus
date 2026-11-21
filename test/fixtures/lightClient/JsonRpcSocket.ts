// @spec-test-coverage-ignore: test-owned JSON-RPC WebSocket client; executable evidence belongs to its calling test declarations
import { resolveWebSocketProviderUrl } from "@/evm/p2pRuntime/RuntimeChainContext";
import { once } from "node:events";
import { type RawData, WebSocket } from "ws";

/** A JSON-RPC request id of this socket. */
type RequestId = number;

/** A JSON-RPC client over one WebSocket: requests, and the notifications pushed to it. */
export class JsonRpcSocket {
    private readonly socket: WebSocket;
    private readonly url: string;
    /** Answers this socket waits for. */
    private readonly answers = new Map<
        RequestId,
        { resolve: (result: unknown) => void; reject: (error: Error) => void }
    >();
    private readonly notificationListeners: ((
        method: string,
        params: unknown
    ) => void)[] = [];
    private nextId = 1;
    /** Why the socket ended; every later request fails with it. */
    private ended: Error | undefined;

    private constructor(socket: WebSocket, url: string) {
        this.socket = socket;
        this.url = url;
        socket.on("message", (data) => this.onMessage(data));
        socket.on("close", (code) =>
            this.end(new Error(`${url} closed with code ${code}`))
        );
        socket.on("error", (error) =>
            this.end(new Error(`${url} failed: ${error.message}`))
        );
    }

    static async open(url: string): Promise<JsonRpcSocket> {
        const webSocketUrl = resolveWebSocketProviderUrl(url);
        const socket = new WebSocket(webSocketUrl);
        await once(socket, "open");
        return new JsonRpcSocket(socket, webSocketUrl);
    }

    /** Calls `listener` with every message that answers no request. */
    onNotification(listener: (method: string, params: unknown) => void): void {
        this.notificationListeners.push(listener);
    }

    /**
     * The `result` of one call; rejects with the JSON-RPC error, or with why the
     * socket ended when it ends first.
     */
    request<T>(method: string, params: unknown[] = []): Promise<T> {
        if (this.ended) return Promise.reject(this.ended);
        if (this.socket.readyState !== WebSocket.OPEN)
            return Promise.reject(new Error(`${this.url} is not open`));
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.answers.set(id, {
                resolve: (result) => resolve(result as T),
                reject
            });
            this.socket.send(
                JSON.stringify({ jsonrpc: "2.0", id, method, params })
            );
        });
    }

    close(): void {
        this.end(new Error(`${this.url} was closed`));
        this.socket.terminate();
    }

    /** Fails every request still waiting, and every later one, with `reason`. */
    private end(reason: Error): void {
        this.ended ??= reason;
        for (const answer of this.answers.values()) answer.reject(this.ended);
        this.answers.clear();
    }

    private onMessage(data: RawData): void {
        const message = JSON.parse(data.toString());
        if (message.id === undefined) {
            for (const listener of this.notificationListeners)
                listener(message.method, message.params);
            return;
        }
        const answer = this.answers.get(message.id);
        if (!answer) return;
        this.answers.delete(message.id);
        if (message.error)
            answer.reject(new Error(JSON.stringify(message.error)));
        else answer.resolve(message.result);
    }
}
