import { RootErrorRpcMethods } from "./RootErrorRpcMethods";
import type { InternalRpcRouter } from "../../../router/InternalRpcRouter";
import { AInternalRpcService } from "../../AInternalRpcService";
import {
    deserializeError,
    serializeError,
    type SerializedError
} from "../../errorWire";
import type InternalTransport from "@/transport/InternalTransport";

/** Autonomous failures travel up the ownership tree; request failures return to their caller. */
export class RootErrorService extends AInternalRpcService<RootErrorRpcMethods> {
    private readonly failureObservers = new WeakMap<
        InternalTransport,
        (error: Error) => void
    >();
    private readonly childHandlers = new WeakMap<
        InternalTransport,
        Set<(error: Error) => void>
    >();

    constructor(
        router: InternalRpcRouter,
        private readonly terminal: (error: unknown) => void
    ) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new RootErrorRpcMethods(this, sender);
    }

    public report(error: unknown): void {
        const parentRemoteRoot = this.router.rpcRoot.parent;
        if (parentRemoteRoot)
            parentRemoteRoot.rpc.errors.report(serializeError(error)).send();
        else this.terminal(error);
    }

    public receive(error: SerializedError, sender: InternalTransport): void {
        this.requireChild(sender);
        const restored = deserializeError(error);
        if (this.router.rpcRoot.lifecycle.failReady(sender, restored)) {
            sender.closeWithReason(restored);
            return;
        }
        const handlers = this.childHandlers.get(sender);
        if (handlers?.size) for (const handler of handlers) handler(restored);
        else this.report(restored);
    }

    public onChildError(
        sender: InternalTransport,
        handler: (error: Error) => void
    ): () => void {
        let handlers = this.childHandlers.get(sender);
        if (!handlers) {
            handlers = new Set();
            this.childHandlers.set(sender, handlers);
            sender.onClosed(() => this.childHandlers.delete(sender));
        }
        handlers.add(handler);
        return () => handlers.delete(handler);
    }

    public startupFailed(
        error: SerializedError,
        sender: InternalTransport
    ): void {
        this.requireChild(sender);
        this.failChild(sender, deserializeError(error));
    }

    public observeChildFailure(
        sender: InternalTransport,
        observer: (error: Error) => void
    ): void {
        this.failureObservers.set(sender, observer);
        sender.onClosed(() => this.failureObservers.delete(sender));
    }

    /**
     * Fatal worker failure: a load-time error, a runtime error event, or an
     * unexpected exit. The first one wins; the exit that follows an error
     * event must not overwrite the original cause. Nothing after disposal
     * counts, because the worker's own exit is expected then.
     */
    public failChild(sender: InternalTransport, error: Error): void {
        // First fatal failure wins; closing rejects pending work with that cause.
        if (sender.isClosed) return;
        if (this.router.rpcRoot.connections.get(sender)?.isDisposing) {
            // An exiting worker cannot acknowledge an in-flight disposal request.
            sender.closeWithReason(error);
            return;
        }
        this.failureObservers.get(sender)?.(error);
        const awaitingReady = this.router.rpcRoot.lifecycle.failReady(
            sender,
            error
        );
        const handlers = [...(this.childHandlers.get(sender) ?? [])];
        sender.closeWithReason(error);
        if (!awaitingReady) {
            if (handlers.length) for (const handler of handlers) handler(error);
            else this.report(error);
        }
    }

    private requireChild(sender: InternalTransport): void {
        if (
            this.router.rpcRoot.connections.get(sender)?.remoteRelation !==
            "child"
        )
            throw new Error("Root errors must arrive from a child connection");
    }
}
