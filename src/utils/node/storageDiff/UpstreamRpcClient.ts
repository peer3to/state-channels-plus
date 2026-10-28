import { isObject } from "./blockStorageDiff";
import WebSocket from "ws";

const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;
/** Unknown subscription ids whose notifications are held for a late answer. */
const MAX_EARLY_SUBSCRIPTIONS = 8;

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

/** Id a node handed out for a subscription it opened. */
type UpstreamSubscriptionId = string;

export type UpstreamHandlers = {
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
    // Notification callbacks, by the subscription id the node assigned.
    private readonly subscriptions = new Map<
        UpstreamSubscriptionId,
        (result: unknown) => void
    >();
    // Notifications that beat their subscription's answer to this client,
    // replayed once `subscribe` knows the id.
    private readonly early = new Map<UpstreamSubscriptionId, unknown[]>();
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

    /** Opens a subscription; `onEvent` gets each notification's `result`. */
    async subscribe(
        method: string,
        params: unknown[],
        onEvent: (result: unknown) => void
    ): Promise<void> {
        const id = await this.request(method, params);
        if (typeof id !== "string") {
            throw new Error(`Malformed ${method} subscription from upstream`);
        }
        this.subscriptions.set(id, onEvent);
        for (const result of this.early.get(id) ?? []) onEvent(result);
        this.early.delete(id);
    }

    async subscribeHeads(onHead: () => void): Promise<void> {
        await this.subscribe("eth_subscribe", ["newHeads"], onHead);
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

    /**
     * Sends `calls` as one JSON-RPC batch array: one round trip. Each call
     * settles on its own, so one error answer fails only its call.
     */
    requestBatch(
        calls: { method: string; params: unknown[] }[]
    ): Promise<unknown>[] {
        if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
            return calls.map(() =>
                Promise.reject(
                    new UpstreamLostError("Upstream connection is not open")
                )
            );
        }
        const frame: unknown[] = [];
        const settled = calls.map(
            ({ method, params }) =>
                new Promise<unknown>((resolve, reject) => {
                    const id = ++this.nextRequestId;
                    const timer = setTimeout(() => {
                        this.pending.delete(id);
                        reject(
                            new UpstreamTimeoutError(
                                `Upstream ${method} timed out`
                            )
                        );
                    }, UPSTREAM_REQUEST_TIMEOUT_MS);
                    this.pending.set(id, { resolve, reject, timer });
                    frame.push({ jsonrpc: "2.0", id, method, params });
                })
        );
        this.socket.send(
            JSON.stringify(frame),
            (error) => error && this.lose(error.message)
        );
        return settled;
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
            const parsed: unknown = JSON.parse(raw);
            // a batch answer: one message per call
            if (Array.isArray(parsed)) {
                for (const answer of parsed) this.onAnswer(answer);
                return;
            }
            this.onAnswer(parsed);
        } catch (error) {
            this.lose(error instanceof Error ? error.message : String(error));
        }
    }

    private onAnswer(message: unknown): void {
        try {
            if (!isObject(message))
                throw new Error("Malformed upstream message");
            // `eth_subscription` and Substrate's `state_storage` alike.
            if (typeof message.method === "string") {
                const params = message.params;
                if (
                    isObject(params) &&
                    typeof params.subscription === "string"
                ) {
                    const onEvent = this.subscriptions.get(params.subscription);
                    if (onEvent) {
                        onEvent(params.result);
                    } else if (this.early.size < MAX_EARLY_SUBSCRIPTIONS) {
                        const held = this.early.get(params.subscription) ?? [];
                        held.push(params.result);
                        this.early.set(params.subscription, held);
                    }
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
