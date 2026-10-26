import { isObject } from "./blockStorageDiff";
import WebSocket from "ws";

const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;

/** JSON-RPC id of a request this client sent upstream. */
type UpstreamRequestId = number;

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

/** The upstream answered a request with a JSON-RPC error. */
export class UpstreamRequestError extends Error {}

/** The upstream did not answer a request in time. */
export class UpstreamTimeoutError extends Error {}

/** The connection could not be opened, or it is gone. */
export class UpstreamLostError extends Error {}

export type UpstreamHandlers = {
    /** A `newHeads` notification arrived. */
    onHead: () => void;
    /** The socket is gone or sent garbage; the client is closed for good. */
    onLost: (error: Error) => void;
};

/**
 * JSON-RPC 2.0 client of the trusted upstream node over one WebSocket. A lost
 * socket or a malformed message ends the client and rejects every pending
 * request with `UpstreamLostError`; an error answer or a timeout rejects only
 * its own request.
 */
export class UpstreamRpcClient {
    private readonly socket: WebSocket;
    private readonly handlers: UpstreamHandlers;
    private readonly pending = new Map<UpstreamRequestId, PendingRequest>();
    private nextRequestId = 0;
    private headSubscription?: string;
    private closed = false;

    private constructor(socket: WebSocket, handlers: UpstreamHandlers) {
        this.socket = socket;
        this.handlers = handlers;
        socket.on("message", (data) => this.onMessage(data.toString()));
        socket.on("error", (error) => this.lose(error.message));
        socket.on("close", () => this.lose("Upstream connection closed"));
    }

    static async connect(
        url: string,
        handlers: UpstreamHandlers
    ): Promise<UpstreamRpcClient> {
        const socket = new WebSocket(url);
        try {
            await new Promise<void>((resolve, reject) => {
                socket.once("open", resolve);
                socket.once("error", reject);
                socket.once("close", () =>
                    reject(new Error("Upstream closed"))
                );
            });
        } catch (error) {
            socket.terminate();
            throw new UpstreamLostError(
                error instanceof Error ? error.message : String(error)
            );
        }
        return new UpstreamRpcClient(socket, handlers);
    }

    async subscribeHeads(): Promise<void> {
        const id = await this.request("eth_subscribe", ["newHeads"]);
        if (typeof id !== "string") {
            throw new Error("Malformed newHeads subscription from upstream");
        }
        this.headSubscription = id;
    }

    request(method: string, params: unknown[]): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
                return reject(
                    new UpstreamLostError("Upstream connection is not open")
                );
            }
            const id = ++this.nextRequestId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new UpstreamTimeoutError(`Upstream ${method} timed out`)
                );
            }, UPSTREAM_REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(
                JSON.stringify({ jsonrpc: "2.0", id, method, params }),
                (error) => error && this.lose(error.message)
            );
        });
    }

    /** Idempotent: rejects pending requests with `reason`, drops the socket. */
    close(reason: Error): void {
        if (this.closed) return;
        this.closed = true;
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(reason);
        }
        this.pending.clear();
        this.socket.terminate();
    }

    private lose(reason: string): void {
        if (this.closed) return;
        const lost = new UpstreamLostError(reason);
        this.close(lost);
        this.handlers.onLost(lost);
    }

    private onMessage(raw: string): void {
        try {
            const message: unknown = JSON.parse(raw);
            if (!isObject(message))
                throw new Error("Malformed upstream message");
            if (message.method === "eth_subscription") {
                const params = message.params;
                if (
                    isObject(params) &&
                    params.subscription === this.headSubscription
                ) {
                    this.handlers.onHead();
                }
                return;
            }
            const request =
                typeof message.id === "number"
                    ? this.pending.get(message.id)
                    : undefined;
            if (!request) return;
            this.pending.delete(message.id as number);
            clearTimeout(request.timer);
            if (isObject(message.error)) {
                const { code, message: text } = message.error;
                request.reject(
                    new UpstreamRequestError(
                        `Upstream request failed (${code}): ${text}`
                    )
                );
            } else if ("result" in message) {
                request.resolve(message.result);
            } else {
                throw new Error("Malformed upstream response");
            }
        } catch (error) {
            this.lose(error instanceof Error ? error.message : String(error));
        }
    }
}
