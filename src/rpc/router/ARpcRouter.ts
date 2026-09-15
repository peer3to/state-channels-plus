import type Rpc from "../Rpc";
import type { RpcResponse } from "../Rpc";
import type ATransport from "@/transport/ATransport";
import { hasRpcService } from "@/utils/ObjectChecks";

export type RpcRequestId = NonNullable<Rpc["requestId"]>;
export type RpcDeliveryOptions = {
    timeoutMs?: number | null;
    transfer?: unknown[];
};

export abstract class ARpcRouter<TTransport extends ATransport = ATransport> {
    private rpcRequestCounter = 0;
    private readonly pendingRpcRequests = new Map<
        RpcRequestId,
        {
            transport: TTransport;
            startedAtMs: number;
            rpc: Rpc;
            resolve: (value: any) => void;
            reject: (error: Error) => void;
            timeout?: ReturnType<typeof setTimeout>;
        }
    >();

    private readonly settlementListeners = new Set<
        (details: {
            transport: TTransport;
            rpc: Rpc;
            requestId: RpcRequestId;
            startedAtMs: number;
            ok: boolean;
        }) => void
    >();

    public onRequestSettled(
        listener: (details: {
            transport: TTransport;
            rpc: Rpc;
            requestId: RpcRequestId;
            startedAtMs: number;
            ok: boolean;
        }) => void
    ): () => void {
        this.settlementListeners.add(listener);
        return () => this.settlementListeners.delete(listener);
    }

    public pendingRequestsFor(transport: TTransport) {
        return [...this.pendingRpcRequests.values()]
            .filter((pending) => pending.transport === transport)
            .map(({ rpc, startedAtMs }) => ({ rpc, startedAtMs }));
    }

    protected abstract get rpcRoot(): object;

    protected async dispatchRpc(
        rpc: Rpc,
        transport: TTransport
    ): Promise<boolean> {
        const root = this.rpcRoot;
        return (
            hasRpcService(root, rpc.service) &&
            (await root[rpc.service].runRPC(rpc, transport))
        );
    }

    public get pendingRequestCount(): number {
        return this.pendingRpcRequests.size;
    }

    protected abstract get defaultRequestTimeoutMs(): number | null;
    protected abstract admitRpcResponse(
        sender: TTransport,
        expected: TTransport
    ): boolean;

    protected scheduleRpcTimeout(
        callback: () => void,
        timeoutMs: number,
        _rpc: Rpc
    ) {
        return setTimeout(callback, timeoutMs);
    }

    protected cancelRpcTimeout(timeout: ReturnType<typeof setTimeout>): void {
        clearTimeout(timeout);
    }

    protected restoreRpcError(error: unknown): Error {
        return new Error(
            typeof error === "string" ? error : "RPC request failed on the peer"
        );
    }

    /**
     * Sends a request-style RPC to a single peer and resolves with the value the
     * peer's handler returns. The promise rejects on a remote error, transport
     * disconnect, or after `timeoutMs` (time safety).
     */
    public sendRpcRequest<TResult = unknown>(
        rpc: Rpc,
        transport: TTransport,
        options?: RpcDeliveryOptions
    ): Promise<TResult> {
        const requestId = `${++this.rpcRequestCounter}`;
        const request = { ...rpc, requestId };
        const timeoutMs =
            options?.timeoutMs === null
                ? null
                : (options?.timeoutMs ?? this.defaultRequestTimeoutMs);
        return new Promise<TResult>((resolve, reject) => {
            const pending = {
                transport,
                rpc: request,
                resolve,
                reject,
                startedAtMs: Date.now(),
                timeout: undefined as ReturnType<typeof setTimeout> | undefined
            };
            this.pendingRpcRequests.set(requestId, pending);
            try {
                if (timeoutMs !== null) {
                    pending.timeout = this.scheduleRpcTimeout(
                        () => {
                            this.rejectRpcRequest(
                                requestId,
                                new Error(
                                    `RPC request '${rpc.service}.${rpc.method}' timed out after ${timeoutMs}ms`
                                )
                            );
                        },
                        timeoutMs,
                        rpc
                    );
                }
                transport.send(request, options?.transfer);
            } catch (error: unknown) {
                this.rejectRpcRequest(
                    requestId,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
    }

    public handleRpcResponse(
        response: RpcResponse<unknown>,
        transport: TTransport
    ): void {
        const pending = this.pendingRpcRequests.get(response.requestId);
        if (!pending || !this.admitRpcResponse(transport, pending.transport))
            return;
        this.pendingRpcRequests.delete(response.requestId);
        if (pending.timeout !== undefined)
            this.cancelRpcTimeout(pending.timeout);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(this.restoreRpcError(response.error));
        for (const listener of this.settlementListeners)
            listener({
                transport,
                rpc: pending.rpc,
                requestId: response.requestId,
                startedAtMs: pending.startedAtMs,
                ok: response.ok
            });
    }

    private rejectRpcRequest(requestId: RpcRequestId, reason: Error): void {
        const pending = this.pendingRpcRequests.get(requestId);
        if (!pending) return;
        this.pendingRpcRequests.delete(requestId);
        if (pending.timeout !== undefined)
            this.cancelRpcTimeout(pending.timeout);
        pending.reject(reason);
    }

    public rejectPendingRpcRequestsForTransport(
        transport: TTransport,
        reason: Error
    ): void {
        for (const [requestId, pending] of this.pendingRpcRequests) {
            if (pending.transport === transport)
                this.rejectRpcRequest(requestId, reason);
        }
    }

    public rejectAllRpcRequests(reason: Error): void {
        for (const requestId of this.pendingRpcRequests.keys())
            this.rejectRpcRequest(requestId, reason);
    }
}
