import type ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import type { Address } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { hasRpcService } from "@/utils/ObjectChecks";
import type ARpcService from "./ARpcService";
import RemoteRpcProxy, { type RemoteRpcProxyType } from "./RemoteRpcProxy";
import Rpc, {
    isRpc,
    isRpcResponse,
    deserializeRpc,
    deserializeRpcResponse,
    MAX_RPC_FRAME_BYTES,
    RpcResponse
} from "./Rpc";
import { errorFromReply, serializeError } from "./serializeError";

export type RpcRequestOptions = {
    /** `null` -> no timer: the operation owns its own bound */
    timeoutMs?: number | null;
};

/**
 * what the transports, services and delivery handles need from the thing that
 * owns them. P2PManager is one (peers), PortRpcRouter is another (a worker
 * port); a service or transport never knows which.
 */
export interface RpcRouterLike {
    readonly logger: Logger;
    readonly localRpc: object;
    readonly remoteRpc: unknown;
    /** "send to self"; only a peer router has one */
    readonly loopbackTransport?: ATransport;
    sendRpcRequest<T>(
        rpc: Rpc,
        transport: ATransport,
        options?: RpcRequestOptions
    ): Promise<T>;
    broadcastRpc(rpc: Rpc): void;
    resolveTransport(address: Address): ATransport | undefined;
    onRpc(serializedRpc: string, transport: ATransport): void;
    onRpcFrame(frame: Rpc | RpcResponse, transport: ATransport): void;
    /** the transport ended, expected or not -> its pending requests reject */
    onTransportClosed(transport: ATransport, isExpected: boolean): void;
    /** a handler failed with no request to answer, or a reply could not be
     *  sent. a peer router disconnects; a port router logs. */
    onServiceFailure(transport: ATransport, error: unknown): void;
}

type PendingRpcRequest = {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    transport: ATransport;
    timeout?: unknown;
    /** `service.method`, for the timeout and failure logs */
    operation: string;
    startedAtMs: number;
};

/** what a closed line still owed */
export type PendingOperation = { operation: string; durationMs: number };

/**
 * the request/response core every line shares: request ids, the pending map,
 * timeouts, reply matching, and dispatch of an inbound frame onto the root's
 * services. subclasses supply timers, targets and what to do when a line or a
 * handler fails.
 */
export abstract class ARpcRouter<TRoot extends object>
    implements RpcRouterLike
{
    localRpc!: TRoot;
    remoteRpc!: RemoteRpcProxyType<TRoot>;
    abstract readonly logger: Logger;
    private rpcRequestCounter = 0;
    private readonly pendingRpcRequests = new Map<string, PendingRpcRequest>();

    abstract broadcastRpc(rpc: Rpc): void;
    abstract resolveTransport(address: Address): ATransport | undefined;
    abstract onTransportClosed(
        transport: ATransport,
        isExpected: boolean
    ): void;
    abstract onServiceFailure(transport: ATransport, error: unknown): void;
    protected abstract scheduleTimeout(
        fn: () => void,
        ms: number,
        label: string
    ): unknown;
    protected abstract cancelTimeout(handle: unknown): void;
    /** `null` -> requests wait as long as they take unless a call says otherwise */
    protected abstract defaultRequestTimeoutMs(): number | null;

    /** a request settled by reply; port routers log the slow ones */
    protected onRequestSettled(
        _operation: string,
        _durationMs: number,
        _ok: boolean
    ): void {}

    /** the root is built with a reference to the router, so it attaches after
     *  construction */
    protected attachRoot(root: TRoot): void {
        this.localRpc = root;
        this.remoteRpc = RemoteRpcProxy.createProxy(
            root
        ) as unknown as RemoteRpcProxyType<TRoot>;
    }

    /** only the transport a request went out on may settle it */
    protected isResponseFromRequestee(
        expected: ATransport,
        actual: ATransport
    ): boolean {
        return expected === actual;
    }

    /** a reply for a request this transport never carried */
    protected onForeignResponse(_transport: ATransport): void {}

    /**
     * Sends a request-style RPC and resolves with the value the far handler
     * returns. The promise rejects on a remote error, transport close, or after
     * `timeoutMs` (time safety); `timeoutMs: null` waits as long as it takes.
     */
    public sendRpcRequest<T = unknown>(
        rpc: Rpc,
        transport: ATransport,
        options?: RpcRequestOptions
    ): Promise<T> {
        const requestId = `${++this.rpcRequestCounter}`;
        const operation = `${rpc.service}.${rpc.method}`;
        const timeoutMs =
            options?.timeoutMs === undefined
                ? this.defaultRequestTimeoutMs()
                : options.timeoutMs;

        return new Promise<T>((resolve, reject) => {
            const timeout =
                timeoutMs === null
                    ? undefined
                    : this.scheduleTimeout(
                          () => {
                              if (this.pendingRpcRequests.delete(requestId)) {
                                  reject(
                                      new Error(
                                          `RPC request '${operation}' timed out after ${timeoutMs}ms`
                                      )
                                  );
                              }
                          },
                          timeoutMs,
                          `rpcRequest:${operation}`
                      );

            this.pendingRpcRequests.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                transport,
                timeout,
                operation,
                startedAtMs: Date.now()
            });

            try {
                transport.send({ ...rpc, requestId });
            } catch (e) {
                if (this.pendingRpcRequests.delete(requestId)) {
                    if (timeout !== undefined) this.cancelTimeout(timeout);
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            }
        });
    }

    private handleRpcResponse(response: RpcResponse, transport: ATransport) {
        const pending = this.pendingRpcRequests.get(response.requestId);
        if (!pending) return;
        if (!this.isResponseFromRequestee(pending.transport, transport)) {
            this.onForeignResponse(transport);
            return;
        }
        this.pendingRpcRequests.delete(response.requestId);
        if (pending.timeout !== undefined) this.cancelTimeout(pending.timeout);
        this.onRequestSettled(
            pending.operation,
            Date.now() - pending.startedAtMs,
            response.ok
        );
        if (response.ok) {
            pending.resolve(response.result);
        } else {
            pending.reject(errorFromReply(response.error));
        }
    }

    protected rejectPendingRpcRequestsForTransport(
        transport: ATransport,
        reason: Error
    ): void {
        for (const [requestId, pending] of this.pendingRpcRequests) {
            if (pending.transport !== transport) continue;
            this.pendingRpcRequests.delete(requestId);
            if (pending.timeout !== undefined)
                this.cancelTimeout(pending.timeout);
            pending.reject(reason);
        }
    }

    /** what a closed transport still owed: for the failure log */
    protected pendingOperationsOn(transport: ATransport): PendingOperation[] {
        const now = Date.now();
        const operations: PendingOperation[] = [];
        for (const pending of this.pendingRpcRequests.values()) {
            if (pending.transport !== transport) continue;
            operations.push({
                operation: pending.operation,
                durationMs: now - pending.startedAtMs
            });
        }
        return operations;
    }

    /** a frame that arrived as bytes: bounded and parsed, then dispatched */
    public onRpc(serializedRpc: string, transport: ATransport) {
        try {
            // Reject oversized frames before parsing so a peer can't force
            // unbounded JSON.parse/dispatch work.
            if (!transport.isTrusted) {
                const frameBytes = Buffer.byteLength(serializedRpc, "utf8");
                if (frameBytes > MAX_RPC_FRAME_BYTES) {
                    this.logger.warn("Oversized RPC frame; disconnecting", {
                        bytes: frameBytes,
                        transportType: TransportType[transport.transportType],
                        peerAddress: transport.peerAddress
                    });
                    this.onServiceFailure(
                        transport,
                        new Error("Oversized RPC frame")
                    );
                    return;
                }
            }
            const response = deserializeRpcResponse(serializedRpc);
            if (response) {
                this.handleRpcResponse(response, transport);
                return;
            }
            const rpc = deserializeRpc(serializedRpc);
            if (!rpc) {
                this.onServiceFailure(
                    transport,
                    new Error("Undecodable RPC frame")
                );
                return;
            }
            this.dispatch(rpc, transport);
        } catch (e) {
            this.onServiceFailure(transport, e);
            this.logger.error("onRpc - error handling RPC frame", {
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
        }
    }

    /** a frame that arrived as an object (a port): validated, then dispatched */
    public onRpcFrame(frame: Rpc | RpcResponse, transport: ATransport): void {
        try {
            if (isRpcResponse(frame)) {
                this.handleRpcResponse(frame, transport);
                return;
            }
            if (!isRpc(frame)) {
                this.onServiceFailure(
                    transport,
                    new Error("Malformed RPC frame")
                );
                return;
            }
            this.dispatch(frame, transport);
        } catch (e) {
            this.onServiceFailure(transport, e);
            this.logger.error("onRpcFrame - error handling RPC frame", {
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
                transportType: TransportType[transport.transportType]
            });
        }
    }

    private dispatch(rpc: Rpc, transport: ATransport): void {
        this.logger.verbose("onRpc", {
            rpc: LoggerUtils.getRpcLogMetadata(rpc),
            transportType: TransportType[transport.transportType],
            peerAddress: transport.peerAddress
        });
        if (!hasRpcService(this.localRpc, rpc.service)) {
            this.refuse(rpc, transport, `Unknown RPC service '${rpc.service}'`);
            return;
        }
        const service = this.localRpc[rpc.service] as unknown as ARpcService<
            any,
            any
        >;
        const success = service.runRPC(rpc, transport);
        if (!success) {
            this.refuse(
                rpc,
                transport,
                `Unknown RPC endpoint '${rpc.service}.${rpc.method}'`
            );
        }
    }

    /** a stranger sending nonsense is disconnected; our own thread asking for
     *  something that does not exist gets told so */
    private refuse(rpc: Rpc, transport: ATransport, reason: string): void {
        const error = new Error(reason);
        if (!transport.isTrusted) {
            this.onServiceFailure(transport, error);
            return;
        }
        if (rpc.requestId === undefined) {
            this.logger.error(reason, { method: rpc.method });
            return;
        }
        transport.sendRpcResponse({
            rpcResponse: true,
            requestId: rpc.requestId,
            ok: false,
            error: serializeError(error)
        });
    }
}

export default ARpcRouter;
