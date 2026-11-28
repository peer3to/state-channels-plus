// @spec-test-coverage-ignore: test-owned JSON-RPC WebSocket client; executable evidence belongs to its calling test declarations
import { once } from "node:events";
import { type RawData, WebSocket } from "ws";

/** A JSON-RPC request id of this socket. */
type RequestId = number;

/** A JSON-RPC client over one WebSocket: requests, and the notifications pushed to it. */
export class JsonRpcSocket {
    private readonly socket: WebSocket;
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

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.on("message", (data) => this.onMessage(data));
    }

    static async open(url: string): Promise<JsonRpcSocket> {
        const socket = new WebSocket(url.replace(/^http/i, "ws"));
        await once(socket, "open");
        return new JsonRpcSocket(socket);
    }

    /** Calls `listener` with every message that answers no request. */
    onNotification(listener: (method: string, params: unknown) => void): void {
        this.notificationListeners.push(listener);
    }

    /** The `result` of one call; rejects with the JSON-RPC error. */
    request<T>(method: string, params: unknown[] = []): Promise<T> {
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
        this.socket.terminate();
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
