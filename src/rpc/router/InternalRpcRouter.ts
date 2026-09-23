import { ARpcRouter } from "./ARpcRouter";
import { isRpc, isRpcResponse } from "../Rpc";
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import {
    deserializeError,
    type SerializedError
} from "@/rpc/internal/errorWire";
import type InternalTransport from "@/transport/InternalTransport";
import { hasRpcService } from "@/utils/ObjectChecks";

export class InternalRpcRouter extends ARpcRouter<InternalTransport> {
    // Request handlers still running per transport, for the services that take
    // part in the disposal drain. A root drains its parent's set before it
    // reports itself disposed, so every reply is queued ahead of the closure
    // that would otherwise reject the request. Notifications have no reply
    // and are not tracked.
    private readonly inFlightHandlers = new Map<
        InternalTransport,
        Set<Promise<unknown>>
    >();

    constructor(
        public readonly rpcRoot: AInternalRpcRoot,
        protected readonly defaultRequestTimeoutMs: number | null,
        private readonly handlerExecutionContext?: HostHandlerExecutionContext
    ) {
        super();
    }

    // Overrides ARpcRouter.restoreRpcError: internal peers use the shared error codec.
    protected override restoreRpcError(error: unknown): Error {
        return typeof error === "string"
            ? new Error(error)
            : deserializeError(error as SerializedError);
    }

    protected admitRpcResponse(
        sender: InternalTransport,
        expected: InternalTransport
    ): boolean {
        return sender === expected;
    }

    private awaitedByDisposalDrain(service: string): boolean {
        const root = this.rpcRoot;
        return (
            hasRpcService(root, service) &&
            root[service] instanceof AInternalRpcService &&
            root[service].awaitedByDisposalDrain
        );
    }

    private trackHandler<T>(
        sender: InternalTransport,
        handler: Promise<T>
    ): Promise<T> {
        let handlers = this.inFlightHandlers.get(sender);
        if (!handlers) {
            handlers = new Set();
            this.inFlightHandlers.set(sender, handlers);
        }
        handlers.add(handler);
        return handler.finally(() => {
            handlers.delete(handler);
            if (handlers.size === 0) this.inFlightHandlers.delete(sender);
        });
    }

    /**
     * Resolves once every tracked request handler running for `transport` has
     * replied, or after `timeoutMs` if one of them never does.
     */
    public async drainInFlightHandlers(
        transport: InternalTransport,
        timeoutMs: number
    ): Promise<void> {
        const handlers = this.inFlightHandlers.get(transport);
        if (!handlers?.size) return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                Promise.allSettled([...handlers]),
                new Promise<void>((resolve) => {
                    timeout = setTimeout(resolve, timeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timeout);
        }
    }

    public async onMessage(
        message: unknown,
        sender: InternalTransport
    ): Promise<void> {
        return this.handlerExecutionContext
            ? this.handlerExecutionContext.runHandler(() =>
                  this.handleMessage(message, sender)
              )
            : this.handleMessage(message, sender);
    }

    private async handleMessage(
        message: unknown,
        sender: InternalTransport
    ): Promise<void> {
        if (sender.isClosed) return;
        if (isRpcResponse(message)) {
            this.handleRpcResponse(message, sender);
            return;
        }
        if (!isRpc(message)) {
            if (
                message &&
                typeof message === "object" &&
                "service" in message &&
                typeof message.service === "string" &&
                "method" in message &&
                typeof message.method === "string" &&
                "requestId" in message &&
                typeof message.requestId === "string" &&
                !("rpcResponse" in message)
            ) {
                sender.sendRpcResponse({
                    rpcResponse: true,
                    requestId: message.requestId,
                    ok: false,
                    error: "Malformed RPC request"
                });
            }
            return;
        }
        const dispatch = this.dispatchRpc(message, sender);
        if (
            await (message.requestId !== undefined &&
            this.awaitedByDisposalDrain(message.service)
                ? this.trackHandler(sender, dispatch)
                : dispatch)
        )
            return;
        if (message.requestId !== undefined) {
            sender.sendRpcResponse({
                rpcResponse: true,
                requestId: message.requestId,
                ok: false,
                error: `Unknown RPC endpoint '${message.service}.${message.method}'`
            });
        }
    }
}
