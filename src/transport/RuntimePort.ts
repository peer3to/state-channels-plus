/**
 * A minimal port surface implemented by both Node `worker_threads`
 * `MessagePort` and the browser `MessagePort`: the wire a worker link runs on.
 */
export interface RuntimePort {
    /** Send a message, optionally transferring ownership of transferables. */
    post(message: unknown, transfer?: unknown[]): void;
    /** Register the single message handler for inbound messages. */
    onMessage(handler: (message: unknown) => void): void;
    /** Begin dispatching messages (no-op where not required). */
    start(): void;
    /**
     * Register a handler for when the other end goes away. Reliable on Node;
     * best-effort in the browser, so callers keep a request timeout as backstop.
     */
    onClose(handler: () => void): void;
    /** Tear down the port. */
    close(): void;
}

/** A linked pair of ports. `port1` stays local; `port2` may be transferred. */
export interface RuntimeChannel {
    port1: RuntimePort;
    port2: RuntimePort;
}
