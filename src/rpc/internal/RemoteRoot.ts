import type { AInternalRpcRoot, RuntimeConnection } from "./AInternalRpcRoot";
import type { SerializedError } from "./errorWire";
import type InternalTransport from "@/transport/InternalTransport";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { SharedLoggerContext } from "@/utils/logging/Logger";

export function childDisposedError(): Error {
    return new Error("Runtime child disposed");
}

/** A connected root owns its RPC surface and its connection lifetime together. */
export class RemoteRoot<T extends AInternalRpcRoot> {
    // createRoot installs cleanup through setAfterDispose.
    // confirmed means the child finished domain cleanup; inline final closure may still be pending.
    private afterDispose?: (confirmed?: boolean) => void | Promise<void>;
    private localPeerRemoteRoot?: RemoteRoot<AInternalRpcRoot>;
    private disposal?: Promise<void>;
    private failureCause?: Error;

    /** Shared RPC infrastructure owns these transport and relationship details. */
    constructor(
        private readonly owner: AInternalRpcRoot,
        public readonly rpc: RuntimeConnection<T>,
        private readonly transport: InternalTransport,
        public readonly sameRealm: boolean,
        public readonly remoteRelation: "parent" | "child"
    ) {
        const removeSettlement = owner.router.onRequestSettled((details) => {
            if (details.transport !== transport) return;
            const metadata = LoggerUtils.getRpcRequestMetadata(
                details.rpc,
                details.startedAtMs
            );
            const { durationMs } = metadata;
            if (durationMs < 1_000) return;
            owner.logger.attachedLogger.warn("Slow worker request completed", {
                ...metadata,
                ok: details.ok,
                pendingRequests:
                    owner.router.pendingRequestsFor(transport).length
            });
        });
        transport.onClosed(removeSettlement);
        if (remoteRelation === "child")
            owner.errors.observeChildFailure(transport, (error) => {
                this.failureCause = error;
                const pending = owner.router.pendingRequestsFor(transport);
                owner.logger.attachedLogger.error(
                    "Worker failed with pending requests",
                    {
                        error,
                        pendingRequests: pending.map(({ rpc, startedAtMs }) =>
                            LoggerUtils.getRpcRequestMetadata(rpc, startedAtMs)
                        )
                    }
                );
            });
    }

    public setAfterDispose(
        callback: (confirmed?: boolean) => void | Promise<void>
    ): void {
        this.afterDispose = callback;
    }

    public completeDisposal(confirmed = false): void | Promise<void> {
        return this.afterDispose?.(confirmed);
    }

    public close(): void {
        this.localPeerRemoteRoot?.owner.closeConnections();
        this.transport.close(true);
    }

    public closeWithReason(reason: Error): void {
        this.transport.closeWithReason(reason);
    }

    /** Wait for the owner's handlers of this connection's requests to reply. */
    public drainInFlightHandlers(timeoutMs: number): Promise<void> {
        return this.owner.router.drainInFlightHandlers(
            this.transport,
            timeoutMs
        );
    }

    public fail(error: Error): void {
        this.owner.errors.failChild(this.transport, error);
    }

    public linkLocalEndpoint(
        peerRemoteRoot: RemoteRoot<AInternalRpcRoot>
    ): void {
        if (!this.sameRealm || !peerRemoteRoot.sameRealm)
            throw new Error(
                "Local endpoint links require two same-realm connections"
            );
        this.localPeerRemoteRoot = peerRemoteRoot;
        peerRemoteRoot.localPeerRemoteRoot = this;
        const remove = () => {
            this.localPeerRemoteRoot = undefined;
            peerRemoteRoot.localPeerRemoteRoot = undefined;
        };
        this.onClosed(remove);
        peerRemoteRoot.onClosed(remove);
    }

    public postContext(context: SharedLoggerContext, index: number): void {
        if (this.localPeerRemoteRoot) {
            this.localPeerRemoteRoot.owner.logger.contextUpdate(
                context,
                index,
                this.localPeerRemoteRoot.transport
            );
            return;
        }
        try {
            this.rpc.logger.contextUpdate({ ...context }, index).send();
        } catch {
            // realm across the port is gone -> its context is moot
        }
    }

    public awaitReady(): Promise<void> {
        return this.owner.lifecycle.awaitReady(this.transport);
    }

    public get failure(): Error | undefined {
        return this.failureCause;
    }

    public get isClosed(): boolean {
        return this.transport.isClosed;
    }

    public get isDisposing(): boolean {
        return this.disposal !== undefined;
    }

    public onClosed(listener: () => void): () => void {
        return this.transport.onClosed(listener);
    }

    public onError(listener: (error: Error) => void): () => void {
        return this.owner.errors.onChildError(this.transport, listener);
    }

    public dispose(): Promise<void> {
        return (this.disposal ??= Promise.resolve().then(async () => {
            try {
                // Disposal owns its cleanup bounds. The generic request timeout can
                // otherwise force shutdown while provider/DHT handles are still
                // closing, which can make Node abort in uv_loop_close().
                if (
                    !this.isClosed &&
                    this.owner.lifecycle.isReady(this.transport)
                )
                    await this.rpc.lifecycle
                        .dispose()
                        .request({ timeoutMs: null });
            } finally {
                await this.completeDisposal();
            }
        }));
    }

    public quiesce(): Promise<SerializedError[]> {
        return this.owner.lifecycle.isReady(this.transport)
            ? this.rpc.lifecycle.quiesce().request({ timeoutMs: null })
            : Promise.resolve([]);
    }
}
