// Peer handler: inbound req dispatch via handler map, outbound res/push frames.

import { serializeError } from "./rpc-errors";
import type { Frame, Req, RpcPort } from "./rpc-types";

type Handler = (args: unknown) => unknown | Promise<unknown>;

export class PeerHandler {
    private handlers = new Map<string, Handler>();
    private disposed = false;
    private readonly onMessage: (raw: unknown) => void;
    private readonly onClose: () => void;

    constructor(private readonly port: RpcPort) {
        this.onMessage = (raw) => this.handleFrame(raw as Frame);
        this.onClose = () => this.dispose();
        this.port.on("message", this.onMessage);
        this.port.on("close", this.onClose);
    }

    register(method: string, fn: Handler): void {
        // Duplicate registration would last-write-win silently.
        if (this.handlers.has(method)) {
            throw new Error(`rpc: duplicate handler '${method}'`);
        }
        this.handlers.set(method, fn);
    }

    unregister(method: string): void {
        this.handlers.delete(method);
    }

    push(topic: string, payload: unknown): void {
        if (this.disposed) return;
        this.safePost({ kind: "push", topic, payload });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.handlers.clear();
        this.port.off("message", this.onMessage);
        this.port.off("close", this.onClose);
        try {
            this.port.close();
        } catch {
            // already closed; swallow
        }
    }

    private handleFrame(raw: unknown): void {
        const f = raw as Frame;
        if (!f || typeof f !== "object") return;
        if (f.kind !== "req") return;
        void this.dispatch(f);
    }

    private async dispatch(f: Req): Promise<void> {
        const fn = this.handlers.get(f.method);
        if (!fn) {
            this.safePost({
                kind: "res",
                id: f.id,
                error: {
                    name: "Error",
                    message: `rpc: no handler '${f.method}'`
                }
            });
            return;
        }
        try {
            const result = await fn(f.args);
            this.safePost({ kind: "res", id: f.id, result });
        } catch (e) {
            this.safePost({
                kind: "res",
                id: f.id,
                error: serializeError(e)
            });
        }
    }

    private safePost(value: unknown): void {
        // Closed ports throw synchronously; late posts are dropped.
        if (this.disposed) return;
        try {
            this.port.postMessage(value);
        } catch {
            // late post against a closed port -> drop
        }
    }
}

// Back-compat alias for in-flight refactors.
export { PeerHandler as RpcServer };
