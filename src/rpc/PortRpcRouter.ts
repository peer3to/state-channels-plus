import type ATransport from "@/transport/ATransport";
import MessagePortTransport from "@/transport/MessagePortTransport";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { Address } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import noOpLogger from "@/utils/logging/noOpLogger";
import { hasRpcService } from "@/utils/ObjectChecks";
import ARpcRouter from "./ARpcRouter";
import RemoteRpcProxy, { type RemoteRpcServices } from "./RemoteRpcProxy";
import Rpc, { isRpc } from "./Rpc";

export type PortRpcRouterOptions = {
    /** bound on every request that does not bring its own; `null` -> none */
    defaultTimeoutMs?: number | null;
    /** runs every inbound dispatch, e.g. inside a handler execution context */
    wrapInbound?: <T>(run: () => T) => T;
    /** a request slower than this is logged once it settles */
    slowRequestMs?: number;
    onClosed?: (transport: ATransport, isExpected: boolean) => void;
};

/**
 * the router for worker links: one per link owner, a MessagePortTransport per
 * port, the root's services on the local end and a typed endpoint for the far
 * one. every port is this process's own thread, so nothing is guarded and a
 * failed handler is logged, never disconnected.
 */
class PortRpcRouter<TRoot extends object> extends ARpcRouter<TRoot> {
    private currentLogger: Logger;
    private readonly options: PortRpcRouterOptions;
    private readonly transports = new Set<MessagePortTransport>();
    /** requests that arrived while this end was still being built; a port
     *  queues what is posted before anyone listens, and this keeps that
     *  promise once a transport is listening */
    private heldRequests?: { frame: Rpc; transport: ATransport }[];

    /** the root needs the router and the router the root -> built here */
    constructor(
        buildRoot: (router: PortRpcRouter<TRoot>) => TRoot,
        logger: Logger | undefined,
        options: PortRpcRouterOptions = {}
    ) {
        super();
        this.currentLogger = logger ?? noOpLogger;
        this.options = options;
        this.attachRoot(buildRoot(this));
    }

    get logger(): Logger {
        return this.currentLogger;
    }

    /** a worker has no logger until its config arrived; the services on the
     *  root were built with the stand-in and take the real one here */
    setLogger(logger: Logger): void {
        this.currentLogger = logger;
        for (const name of Object.keys(this.localRpc)) {
            if (hasRpcService(this.localRpc, name)) {
                this.localRpc[name].logger = logger;
            }
        }
    }

    attach(port: RuntimePort): MessagePortTransport {
        const transport = new MessagePortTransport(port, this);
        this.transports.add(transport);
        return transport;
    }

    /** queue inbound requests until `releaseInbound`: the services behind the
     *  root are not all built yet. replies to this end's own requests still
     *  settle. */
    holdInbound(): void {
        this.heldRequests ??= [];
    }

    /** dispatch what was held, in arrival order, and stop holding */
    releaseInbound(): void {
        const held = this.heldRequests;
        this.heldRequests = undefined;
        for (const { frame, transport } of held ?? []) {
            super.onRpcFrame(frame, transport);
        }
    }

    /** the far end of `transport`, typed by the root it serves */
    endpoint<TRemoteRoot extends object>(
        transport: ATransport,
        manifest: readonly (keyof TRemoteRoot & string)[]
    ): RemoteRpcServices<TRemoteRoot> {
        return RemoteRpcProxy.createEndpoint<TRemoteRoot>(
            this,
            transport,
            manifest
        );
    }

    // ----- ARpcRouter hooks -----

    public broadcastRpc(rpc: Rpc): void {
        for (const transport of this.transports) transport.send(rpc);
    }

    /** addresses are a peer concept; a port has no address */
    public resolveTransport(_address: Address): ATransport | undefined {
        return undefined;
    }

    public onRpcFrame(
        frame: Parameters<ARpcRouter<TRoot>["onRpcFrame"]>[0],
        transport: ATransport
    ): void {
        if (this.heldRequests && isRpc(frame)) {
            this.heldRequests.push({ frame, transport });
            return;
        }
        const wrap = this.options.wrapInbound;
        if (wrap) {
            wrap(() => super.onRpcFrame(frame, transport));
            return;
        }
        super.onRpcFrame(frame, transport);
    }

    public onTransportClosed(transport: ATransport, isExpected: boolean): void {
        this.transports.delete(transport as MessagePortTransport);
        const pendingRequests = this.pendingOperationsOn(transport);
        if (!isExpected && pendingRequests.length > 0) {
            this.logger.error("Worker link closed with pending requests", {
                pendingRequests
            });
        }
        this.rejectPendingRpcRequestsForTransport(
            transport,
            new Error(
                isExpected
                    ? "Worker link disposed"
                    : "Worker link closed before the reply arrived"
            )
        );
        this.options.onClosed?.(transport, isExpected);
    }

    /** our own thread misbehaving is a bug to log, not a peer to drop */
    public onServiceFailure(_transport: ATransport, error: unknown): void {
        this.logger.error("Worker RPC handler failed", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    }

    protected scheduleTimeout(fn: () => void, ms: number): unknown {
        return setTimeout(fn, ms);
    }

    protected cancelTimeout(handle: unknown): void {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    }

    protected defaultRequestTimeoutMs(): number | null {
        return this.options.defaultTimeoutMs ?? null;
    }

    protected onRequestSettled(
        operation: string,
        durationMs: number,
        ok: boolean
    ): void {
        const slowRequestMs = this.options.slowRequestMs;
        if (slowRequestMs === undefined || durationMs < slowRequestMs) return;
        this.logger.warn("Slow worker request completed", {
            operation,
            durationMs,
            ok
        });
    }
}

export default PortRpcRouter;
