// W3 - worker-side rpc server. handler map + push channel. responds to req
// frames with res; emits push frames on its own initiative.

import { serializeError } from "./rpc-errors";
import type { Frame, Req, RpcPort } from "./rpc-types";

type Handler = (args: unknown) => unknown | Promise<unknown>;

export class RpcServer {
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
        // step 1 - guard against accidental double-register -> last-write-wins
        // would silently alias otherwise. explicit unregister required.
        if (this.handlers.has(method)) {
            throw new Error(`rpc: duplicate handler '${method}'`);
        }
        this.handlers.set(method, fn);
    }

    unregister(method: string): void {
        this.handlers.delete(method);
    }

    // step 1 - one-direction worker -> orchestrator push frame.
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
        if (f.kind !== "req") return; // step 1 - server only acts on req frames
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
        // step 1 - guard every outbound postMessage. closed ports throw
        // synchronously (DataCloneError / "port is closed" on some node
        // builds). callers' resolved values are discarded silently.
        if (this.disposed) return;
        try {
            this.port.postMessage(value);
        } catch {
            // late post against a closed port -> drop
        }
    }
}
