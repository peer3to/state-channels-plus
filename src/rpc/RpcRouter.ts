import type ARpcService from "./ARpcService";
import { createRemoteRpcProxy, type RemoteRpcServices } from "./RemoteRpcProxy";
import Rpc, {
    isRpc,
    isRpcResponse,
    deserializeRpcFrame,
    MAX_RPC_FRAME_BYTES,
    RpcResponse
} from "./Rpc";
import { errorFromReply, serializeError } from "./serializeError";
import type ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import type { Address } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import noOpLogger from "@/utils/logging/noOpLogger";
import { hasRpcService } from "@/utils/ObjectChecks";

/** what failed: a frame the far end sent, a reply for a request this line
 *  never carried, or one of our own handlers */
type ServiceFailureKind = "frame" | "handler" | "foreign-response";

export type RpcRequestOptions = {
    /** `null` -> no timer: the operation owns its own bound */
    timeoutMs?: number | null;
};

/** what schedules a request's timeout. `TimeoutManager` is one; plain timers
 *  are the default. */
export interface RpcTimer {
    scheduleTask(
        task: () => void,
        delayMs: number,
        taskName?: string
    ): ReturnType<typeof setTimeout>;
    cancelTask(handle: ReturnType<typeof setTimeout>): void;
}

const plainTimer: RpcTimer = {
    scheduleTask: (task, delayMs) => setTimeout(task, delayMs),
    cancelTask: (handle) => clearTimeout(handle)
};

export type RpcRouterOptions = {
    timer?: RpcTimer;
};

type PendingRpcRequest = {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    transport: ATransport;
    timeout?: ReturnType<typeof setTimeout>;
    /** `service.method`, for the timeout and failure logs */
    operation: string;
    startedAtMs: number;
};

/** what a closed line still owed */
export type PendingOperation = { operation: string; durationMs: number };

/**
 * the request/response core every line shares: request ids, the pending map,
 * timeouts, reply matching, and dispatch of an inbound frame onto the root's
 * services. one router per realm end - `P2PManager` is the peers' one and
 * assigns its peer policy to the fields below; a worker port keeps the
 * defaults.
 *
 * `TRoot` is what this end serves, `TRemote` what the far end serves and what
 * `remoteRpc` is typed by.
 */
export class RpcRouter<TRoot extends object, TRemote extends object = TRoot> {
    localRpc!: TRoot;
    remoteRpc!: RemoteRpcServices<TRemote>;
    logger: Logger;
    /** every transport delivering to this router; `broadcastRpc` and an
     *  omitted request target read it */
    readonly transports = new Set<ATransport>();
    /** "send to self"; only the peer router has one */
    loopbackTransport?: ATransport;
    /** peers resolve an address to its transport; a port has no address */
    resolveTransport: (address: Address) => ATransport | undefined = () =>
        undefined;
    /** only the transport a request went out on may settle it. peers compare
     *  by peer identity so a transport upgrade still settles the request. */
    isSameSender: (expected: ATransport, actual: ATransport) => boolean = (
        expected,
        actual
    ) => expected === actual;
    /** a frame this router refused, a reply for a request this line never
     *  carried, or a handler that failed with no request to answer. our own
     *  thread misbehaving is a bug to log; peers drop the line and ban. */
    onBadFrame: (
        transport: ATransport,
        error: unknown,
        kind: ServiceFailureKind
    ) => void = (_transport, error, kind) => {
        this.logger.error("Worker RPC frame failed", {
            kind,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    };
    /** an inbound request about to be dispatched; peers log it */
    onFrameDispatched?: (rpc: Rpc, transport: ATransport) => void;
    /** the bound on a request that brings none; `null` -> it waits as long as
     *  it takes. read per request, so peers pick up a time-config change. */
    requestTimeoutMs: () => number | null = () => null;
    /** runs every inbound dispatch, e.g. inside a handler execution context */
    wrapInbound?: <T>(run: () => T) => T;
    private readonly timer: RpcTimer;
    private rpcRequestCounter = 0;
    private readonly pendingRpcRequests = new Map<string, PendingRpcRequest>();

    /** the root needs the router and the router the root -> built here. a root
     *  that cannot be built before its owner's fields exist attaches later. */
    constructor(
        buildRoot: ((router: RpcRouter<TRoot, TRemote>) => TRoot) | undefined,
        logger: Logger | undefined,
        options: RpcRouterOptions = {}
    ) {
        this.logger = logger ?? noOpLogger;
        this.timer = options.timer ?? plainTimer;
        if (buildRoot) this.attachRoot(buildRoot(this));
    }

    /** a worker has no logger until its config arrived; the services on the
     *  root were built with the stand-in and take the real one here */
    setLogger(logger: Logger): void {
        this.logger = logger;
        for (const name of Object.keys(this.localRpc)) {
            if (hasRpcService(this.localRpc, name)) {
                this.localRpc[name].logger = logger;
            }
        }
    }

    /** the root is built with a reference to the router, so it attaches after
     *  construction */
    protected attachRoot(root: TRoot): void {
        this.localRpc = root;
        this.remoteRpc = createRemoteRpcProxy<TRemote>(this);
    }

    public broadcastRpc(rpc: Rpc): void {
        for (const transport of this.transports) transport.send(rpc);
    }

    /** a transport was built: it delivers here from now on */
    public onTransportCreated(transport: ATransport): void {
        this.transports.add(transport);
    }

    /** the transport ended, expected or not -> its pending requests reject */
    public onTransportClosed(transport: ATransport, isExpected: boolean): void {
        this.transports.delete(transport);
        const pendingRequests = this.pendingOperationsOn(transport);
        if (!isExpected && pendingRequests.length > 0) {
            this.logger.error("RPC transport closed with pending requests", {
                pendingRequests
            });
        }
        this.rejectPending(
            transport,
            new Error(
                isExpected ? "RPC transport disposed" : "RPC transport closed"
            )
        );
    }

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
        // a post on a closed line is dropped without a word, so a request
        // there would only ever time out; refuse it now instead
        if (transport.isClosed) {
            return Promise.reject(
                new Error(
                    `RPC request '${operation}' refused: the transport is closed or disposed`
                )
            );
        }
        const timeoutMs =
            options?.timeoutMs === undefined
                ? this.requestTimeoutMs()
                : options.timeoutMs;

        return new Promise<T>((resolve, reject) => {
            const timeout =
                timeoutMs === null
                    ? undefined
                    : this.timer.scheduleTask(
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
                    if (timeout !== undefined) this.timer.cancelTask(timeout);
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            }
        });
    }

    private handleRpcResponse(response: RpcResponse, transport: ATransport) {
        const pending = this.pendingRpcRequests.get(response.requestId);
        if (!pending) return;
        if (!this.isSameSender(pending.transport, transport)) {
            this.onBadFrame(
                transport,
                new Error("RPC reply for a request this line never carried"),
                "foreign-response"
            );
            return;
        }
        this.pendingRpcRequests.delete(response.requestId);
        if (pending.timeout !== undefined) {
            this.timer.cancelTask(pending.timeout);
        }
        if (response.ok) {
            pending.resolve(response.result);
        } else {
            pending.reject(errorFromReply(response.error));
        }
    }

    public rejectPending(transport: ATransport, reason: Error): void {
        for (const [requestId, pending] of this.pendingRpcRequests) {
            if (pending.transport !== transport) continue;
            this.pendingRpcRequests.delete(requestId);
            if (pending.timeout !== undefined) {
                this.timer.cancelTask(pending.timeout);
            }
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
                    this.onBadFrame(
                        transport,
                        new Error("Oversized RPC frame"),
                        "frame"
                    );
                    return;
                }
            }
            const frame = deserializeRpcFrame(serializedRpc);
            if (!frame) {
                this.onBadFrame(
                    transport,
                    new Error("Undecodable RPC frame"),
                    "frame"
                );
                return;
            }
            this.runInbound(() =>
                frame.kind === "response"
                    ? this.handleRpcResponse(frame.response, transport)
                    : this.dispatch(frame.rpc, transport)
            );
        } catch (e) {
            // an exception escaping dispatch is our own handler failing, not
            // a frame the peer got wrong
            this.onBadFrame(transport, e, "handler");
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
        this.runInbound(() => this.deliverFrame(frame, transport));
    }

    /** every inbound delivery, inside the execution context the policy wants */
    private runInbound(deliver: () => void): void {
        if (this.wrapInbound) {
            this.wrapInbound(deliver);
            return;
        }
        deliver();
    }

    private deliverFrame(
        frame: Rpc | RpcResponse,
        transport: ATransport
    ): void {
        try {
            if (isRpcResponse(frame)) {
                this.handleRpcResponse(frame, transport);
                return;
            }
            if (!isRpc(frame)) {
                this.onBadFrame(
                    transport,
                    new Error("Malformed RPC frame"),
                    "frame"
                );
                return;
            }
            this.dispatch(frame, transport);
        } catch (e) {
            this.onBadFrame(transport, e, "handler");
            this.logger.error("onRpcFrame - error handling RPC frame", {
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
                transportType: TransportType[transport.transportType]
            });
        }
    }

    private dispatch(rpc: Rpc, transport: ATransport): void {
        this.onFrameDispatched?.(rpc, transport);
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
            this.onBadFrame(transport, error, "frame");
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

export default RpcRouter;
