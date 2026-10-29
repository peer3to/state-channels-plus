import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import { hasMethod } from "@/utils/ObjectChecks";

abstract class ATransport {
    public isClosed = false;
    private readonly closedListeners = new Set<() => void>();

    public abstract send(rpc: Rpc, transfer?: unknown[]): void;
    public abstract sendRpcResponse(response: RpcResponse<any>): void;
    public abstract onMessage(data: unknown): void;
    protected abstract afterClose(isExpected: boolean): void;
    protected beforeClose(_isExpected: boolean): void {}

    public close(isExpected = false): void {
        if (this.isClosed) return;
        this.beforeClose(isExpected);
        this.isClosed = true;
        for (const listener of [...this.closedListeners]) listener();
        this.closedListeners.clear();
        this.afterClose(isExpected);
    }

    public onClosed(listener: (transport: this) => void): () => void {
        if (this.isClosed) {
            listener(this);
            return () => undefined;
        }
        const notify = () => listener(this);
        this.closedListeners.add(notify);
        return () => this.closedListeners.delete(notify);
    }
}

/**
 * Type guard for transports loaded from any JavaScript module graph.
 */
export function isTransport(value: unknown): value is ATransport {
    return (
        hasMethod(value, "send") &&
        hasMethod(value, "sendRpcResponse") &&
        hasMethod(value, "close")
    );
}

export default ATransport;
