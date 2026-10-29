import { RuntimeLifecycleRpcMethods } from "./RuntimeLifecycleRpcMethods";
import { serializeError, type SerializedError } from "../../errorWire";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import { childDisposedError } from "@/rpc/internal/RemoteRoot";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type Rpc from "@/rpc/Rpc";
import type InternalTransport from "@/transport/InternalTransport";
import { DetachedPromises } from "@/utils/DetachedPromises";
import { runCleanup } from "@/utils/runCleanup";

interface ChildReadiness {
    ready: Promise<void>;
    resolveReady(): void;
    rejectReady(error: Error): void;
    readySettled: boolean;
    readySucceeded: boolean;
}

export class RuntimeLifecycleService extends AInternalRpcService<RuntimeLifecycleRpcMethods> {
    public closeAfterDispose?: () => void | Promise<void>;
    private readonly childReadiness = new WeakMap<
        InternalTransport,
        ChildReadiness
    >();
    private readiness?: Promise<void>;
    private quiescence?: Promise<SerializedError[]>;
    private disposalReplySender?: InternalTransport;
    private closure?: Promise<void>;

    constructor(router: InternalRpcRouter) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new RuntimeLifecycleRpcMethods(this, sender);
    }

    public connectionAdded(transport: InternalTransport): void {
        const remoteRoot = this.router.rpcRoot.connections.get(transport);
        if (remoteRoot?.remoteRelation !== "child") return;
        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        // A child may fail before its owner starts waiting. Keep the rejection for awaitReady.
        void ready.catch(() => undefined);
        this.childReadiness.set(transport, {
            ready,
            resolveReady,
            rejectReady,
            readySettled: false,
            readySucceeded: false
        });
        transport.onClosed(() =>
            this.failReady(
                transport,
                new Error("Runtime child closed before ready")
            )
        );
    }

    public awaitReady(child: InternalTransport): Promise<void> {
        return this.child(child).ready;
    }

    public isReady(child: InternalTransport): boolean {
        return this.childReadiness.get(child)?.readySucceeded ?? false;
    }

    public receiveReady(sender: InternalTransport): void {
        const child = this.childReadiness.get(sender);
        if (!child || child.readySettled) return;
        child.readySettled = true;
        child.readySucceeded = true;
        this.router.rpcRoot.logger.sendContext(sender);
        child.resolveReady();
    }

    public failReady(child: InternalTransport, error: Error): boolean {
        const state = this.child(child);
        if (state.readySettled) return false;
        state.readySettled = true;
        state.rejectReady(error);
        return true;
    }

    public signalReady(): Promise<void> {
        return (this.readiness ??= Promise.resolve().then(async () => {
            // Root startup awaits required child creation; a forwarded bridge port may attach later.
            this.router.rpcRoot.parent?.rpc.lifecycle.ready().send();
        }));
    }

    public requireParent(sender: InternalTransport): void {
        if (
            this.router.rpcRoot.connections.get(sender)?.remoteRelation !==
            "parent"
        )
            throw new Error(
                "Lifecycle cleanup must be requested by a parent connection"
            );
    }

    public receiveDisposed(sender: InternalTransport): void {
        const root = this.router.rpcRoot;
        const remoteRoot = root.connections.get(sender);
        if (remoteRoot?.remoteRelation !== "child")
            throw new Error("Disposal notification must come from a child");
    }

    private async finishChildDisposal(
        sender: InternalTransport
    ): Promise<void> {
        const root = this.router.rpcRoot;
        const remoteRoot = root.connections.get(sender);
        if (remoteRoot?.remoteRelation !== "child") return;
        try {
            // The reply is posted. Let an inline child receive it and finish before
            // close observers start disposing its parent.
            await remoteRoot.completeDisposal(true);
        } catch (error) {
            if (!remoteRoot.isDisposing) root.reportError(error);
        } finally {
            sender.closeWithReason(childDisposedError());
        }
    }

    public disposeFromParent(sender: InternalTransport): Promise<void> {
        this.requireParent(sender);
        this.disposalReplySender = sender;
        return this.router.rpcRoot.dispose();
    }

    // Overrides AInternalRpcService.awaitedByDisposalDrain: a parent-requested
    // disposal runs as one of this service's handlers and replies only after
    // the disposal that drains the others, so waiting on it would wait on itself.
    public override get awaitedByDisposalDrain(): boolean {
        return false;
    }

    /** Final shutdown waits for acknowledgement; parent-requested cleanup first replies. */
    public completeDisposal(parentRequested = false): Promise<void> {
        if (this.disposalReplySender) return Promise.resolve();
        return (this.closure ??= Promise.resolve().then(async () => {
            const root = this.router.rpcRoot;
            const parent = root.parent;
            await runCleanup(
                async () => {
                    try {
                        if (parent && !parent.isClosed)
                            // The parent must process disposal before worker exit can overtake this port.
                            await parent.rpc.lifecycle
                                .disposed()
                                .request({ timeoutMs: null });
                    } catch (error) {
                        // After the dispose reply, parent closure also confirms receipt.
                        if (!parentRequested || !parent?.isClosed) throw error;
                    }
                },
                () => root.closeConnections(),
                () => this.closeAfterDispose?.()
            );
        }));
    }

    public disposalResponseAttempted(sender: InternalTransport): void {
        // Admission happened before cleanup; the parent may have closed since then.
        if (this.disposalReplySender !== sender) return;
        this.disposalReplySender = undefined;
        // Only acknowledge final shutdown after the original disposal response attempt.
        void this.completeDisposal(true).catch((error) =>
            this.router.rpcRoot.reportError(error)
        );
    }

    // Overrides AInternalRpcService.afterResponse to keep cleanup after acknowledgement.
    protected override afterResponse(
        rpc: Rpc,
        sender: InternalTransport
    ): void {
        if (rpc.method === "dispose") this.disposalResponseAttempted(sender);
        if (rpc.method === "disposed") void this.finishChildDisposal(sender);
    }

    public quiesce(): Promise<SerializedError[]> {
        return (this.quiescence ??= Promise.resolve()
            .then(async () => {
                const children = await Promise.allSettled(
                    [...this.router.rpcRoot.children].map((childRemoteRoot) =>
                        childRemoteRoot.quiesce()
                    )
                );
                const local = await this.quiesceOwnRuntime();
                const failed = children.find(
                    (entry) => entry.status === "rejected"
                );
                if (failed?.status === "rejected") throw failed.reason;
                return children
                    .flatMap((entry) =>
                        entry.status === "fulfilled" ? entry.value : []
                    )
                    .concat(local);
            })
            .finally(() => {
                this.quiescence = undefined;
            }));
    }

    private child(child: InternalTransport): ChildReadiness {
        const state = this.childReadiness.get(child);
        if (!state)
            throw new Error("Connection is not a child of this runtime");
        return state;
    }

    private async quiesceOwnRuntime(): Promise<SerializedError[]> {
        // Drain this host realm's detached promises and report the
        // ones that rejected, so the orchestrator can settle and
        // surface host-side async work over the port.
        // TODO: Separate operation promises from cleanup promises
        // so disposal can cancel cleanup without a bounded drain.
        const settled = this.router.rpcRoot.isDisposed
            ? await DetachedPromises.collectSettledAndClear()
            : await DetachedPromises.awaitAllAndClear();
        return settled
            .filter((entry) => entry.status === "rejected")
            .map((entry) =>
                serializeError((entry as PromiseRejectedResult).reason)
            );
    }
}
