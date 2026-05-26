// W3 - orchestrator-side rpc client. correlation-id map + queue + push topic
// dispatch. mirror of boss's evm executor pattern: park the promise under an
// id, fire the req, response with same id resolves it.

import { deserializeError } from "./rpc-errors";
import type { Frame, Push, Res, RpcPort } from "./rpc-types";

type Pending = {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
};

type PushListener = (payload: unknown) => void;

const DISPOSED_MESSAGE = "rpc client disposed";

export class RpcClient {
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private listeners = new Map<string, Set<PushListener>>();
    private disposed = false;
    private readonly onMessage: (raw: unknown) => void;
    private readonly onClose: () => void;

    constructor(private readonly port: RpcPort) {
        this.onMessage = (raw) => this.handleFrame(raw as Frame);
        this.onClose = () => this.dispose();
        this.port.on("message", this.onMessage);
        this.port.on("close", this.onClose);
    }

    call(method: string, args: unknown): Promise<unknown> {
        if (this.disposed) {
            return Promise.reject(new Error(DISPOSED_MESSAGE));
        }
        const id = this.nextId++;
        return new Promise<unknown>((resolve, reject) => {
            // step 1 - guard against id reuse -> programmer error during dev
            if (this.pending.has(id)) {
                reject(new Error(`rpc: duplicate id ${id}`));
                return;
            }
            // step 2 - park promise under its id
            this.pending.set(id, { resolve, reject });
            // step 3 - fire the req. closed-port throws caught -> reject.
            try {
                this.port.postMessage({ kind: "req", id, method, args });
            } catch (e) {
                this.pending.delete(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }

    // step 1 - subscribe to push frames by topic. W4 uses this for spy/event
    // signals, W6 uses it for loop-stall reports.
    on(topic: string, listener: PushListener): void {
        let set = this.listeners.get(topic);
        if (!set) {
            set = new Set();
            this.listeners.set(topic, set);
        }
        set.add(listener);
    }

    off(topic: string, listener: PushListener): void {
        this.listeners.get(topic)?.delete(listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // step 1 - reject all in-flight with a clear error
        for (const { reject } of this.pending.values()) {
            reject(new Error(DISPOSED_MESSAGE));
        }
        this.pending.clear();
        this.listeners.clear();
        this.port.off("message", this.onMessage);
        this.port.off("close", this.onClose);
        // step 2 - close port -> other side gets close event
        try {
            this.port.close();
        } catch {
            // already closed; swallow
        }
    }

    private handleFrame(f: Frame): void {
        if (!f || typeof f !== "object") return;
        if (f.kind === "res") {
            this.handleRes(f);
        } else if (f.kind === "push") {
            this.handlePush(f);
        }
        // step 1 - req frames on client port are dropped silently.
        // workers don't initiate req frames at the client side; if one shows up
        // it's wire-level confusion and we drop it. (handlers belong on Server.)
    }

    private handleRes(f: Res): void {
        const entry = this.pending.get(f.id);
        if (!entry) return; // step 1 - late or unknown -> drop
        this.pending.delete(f.id);
        if (f.error) {
            entry.reject(deserializeError(f.error));
        } else {
            entry.resolve(f.result);
        }
    }

    private handlePush(f: Push): void {
        const set = this.listeners.get(f.topic);
        if (!set || set.size === 0) return;
        for (const listener of set) {
            try {
                listener(f.payload);
            } catch {
                // listener errors are not the kernel's problem
            }
        }
    }
}
