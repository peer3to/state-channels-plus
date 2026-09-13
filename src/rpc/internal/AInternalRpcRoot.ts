import type { RootStartContext } from "./createRoot";
import { RemoteRoot } from "./RemoteRoot";
import { createRpcProxy } from "../createRpcProxy";
import { AInternalRpcService } from "./AInternalRpcService";
import type { RpcDeliveryOptions } from "../router/ARpcRouter";
import { InternalRpcRouter } from "../router/InternalRpcRouter";
import { RootErrorService } from "./services/errors/RootErrorService";
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";
import { RuntimeLifecycleService } from "@/rpc/internal/services/lifecycle/RuntimeLifecycleService";
import { LoggerService } from "@/rpc/internal/services/logger/LoggerService";
import InternalTransport from "@/transport/InternalTransport";
import type { RuntimePort } from "@/transport/RuntimePort";
import { config } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import { runCleanup } from "@/utils/runCleanup";
import { createLogger } from "@platform/createLogger";

type RootRpcServices<T extends AInternalRpcRoot> = {
    [K in keyof T as T[K] extends AInternalRpcService<any>
        ? K
        : never]: T[K] extends AInternalRpcService<infer M>
        ? {
              [P in keyof M as M[P] extends (...args: any[]) => unknown
                  ? P
                  : never]: M[P] extends (...args: infer A) => infer R
                  ? (...args: A) => {
                        request(
                            options?: RpcDeliveryOptions
                        ): Promise<Awaited<R>>;
                        send(
                            options?: Pick<RpcDeliveryOptions, "transfer">
                        ): void;
                    }
                  : never;
          }
        : never;
};

export type RuntimeConnection<T extends AInternalRpcRoot> = RootRpcServices<T> &
    RootRpcServices<AInternalRpcRoot>;

export abstract class AInternalRpcRoot<
    TParent extends AInternalRpcRoot = AInternalRpcRoot<any>
> {
    // Common services included by every internal endpoint.
    public readonly logger: LoggerService;
    public readonly rootLogger: Logger;
    public readonly errors: RootErrorService;
    public readonly lifecycle: RuntimeLifecycleService;

    private disposal?: Promise<void>;
    private startContext?: RootStartContext;

    private readonly closeListeners = new Set<() => void>();
    public readonly router: InternalRpcRouter;
    public readonly connections = new Map<
        InternalTransport,
        RemoteRoot<AInternalRpcRoot>
    >();

    constructor(
        onError: (error: unknown) => void,
        timeoutMs: number | null = 30_000,
        context?: RootStartContext
    ) {
        const handlerExecutionContext = context?.handlerExecutionContext;
        this.startContext = context;
        this.router = new InternalRpcRouter(this, timeoutMs);
        if (handlerExecutionContext) {
            const onMessage = this.router.onMessage.bind(this.router);
            this.router.onMessage = (message, sender) =>
                handlerExecutionContext.runHandler(() =>
                    onMessage(message, sender)
                );
        }
        this.errors = new RootErrorService(this.router, onError);
        this.logger = new LoggerService(this);
        this.rootLogger =
            context?.logger ??
            createLogger(
                context?.loggerContext ?? {},
                { component: this.constructor.name },
                { loggerService: this.logger, attachErrorListener: true }
            );
        // A supplied child keeps its family's existing store attachment.
        if (!this.rootLogger.loggerService)
            this.rootLogger.attachLoggerService(this.logger);
        this.lifecycle = new RuntimeLifecycleService(this.router);
    }

    public get handlerExecutionContext():
        | HostHandlerExecutionContext
        | undefined {
        return this.startContext?.handlerExecutionContext;
    }

    public get parent(): RemoteRoot<TParent> | null {
        return (
            ([...this.connections.values()].find(
                (remoteRoot) => remoteRoot.remoteRelation === "parent"
            ) as RemoteRoot<TParent> | undefined) ?? null
        );
    }
    public get children(): ReadonlySet<RemoteRoot<AInternalRpcRoot>> {
        return new Set(
            [...this.connections.values()].filter(
                (remoteRoot) => remoteRoot.remoteRelation === "child"
            )
        );
    }
    public get isDisposed(): boolean {
        return this.isDisposing;
    }

    public async startRuntime(context: RootStartContext): Promise<void> {
        this.startContext = context;
        await this.start();
        // An active thread monitor keeps its existing options.
        if (
            context.mode === "worker" &&
            config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0
        )
            this.logger.attachedLogger.startPerformanceMonitoring({
                threadLabel: globalThis.threadName
            });
    }

    public abstract start(): Promise<void>;

    public abstract dispose(): Promise<void>;

    /** Shared recursive cleanup; concrete roots supply their own local work. */
    protected disposeRoot(
        cleanup: () => void | Promise<void>,
        prepare?: () => void | Promise<void>
    ): Promise<void> {
        return (this.disposal ??= Promise.resolve().then(async () => {
            await runCleanup(
                () => prepare?.(),
                async () => {
                    const children = await Promise.allSettled(
                        [...this.children].map((childRemoteRoot) =>
                            childRemoteRoot.dispose()
                        )
                    );
                    const failure = children.find(
                        (child) => child.status === "rejected"
                    );
                    if (failure?.status === "rejected") throw failure.reason;
                },
                // Local cleanup must still run after a child fails.
                () => {
                    if (this.startContext?.mode === "worker")
                        this.logger.attachedLogger.stopPerformanceMonitoring();
                },
                cleanup,
                // Release logging last, even when domain cleanup fails.
                () => this.rootLogger.dispose({ cascadeChildren: true }),
                () => this.logger.dispose(),
                () => this.lifecycle.completeDisposal()
            );
        }));
    }

    public get isDisposing(): boolean {
        return this.disposal !== undefined;
    }

    public reportError(error: unknown): void {
        this.errors.report(error);
    }

    public connect<T extends AInternalRpcRoot>(
        port: RuntimePort,
        placement: Pick<RemoteRoot<T>, "sameRealm" | "remoteRelation">
    ): RemoteRoot<T> {
        if (placement.remoteRelation === "parent" && this.parent)
            throw new Error("A root can have only one parent");
        const transport = new InternalTransport(this.router, port);
        transport.onClosed(() => this.connections.delete(transport));
        const remote = createRpcProxy((rpc) => ({
            request: (options?: RpcDeliveryOptions) =>
                this.router.sendRpcRequest(rpc, transport, options),
            send: (options?: Pick<RpcDeliveryOptions, "transfer">) =>
                transport.send(rpc, options?.transfer)
        })) as RuntimeConnection<T>;
        const remoteRoot = new RemoteRoot<T>(
            this,
            remote,
            transport,
            placement.sameRealm,
            placement.remoteRelation
        );
        this.connections.set(transport, remoteRoot);
        this.lifecycle.connectionAdded(transport);
        return remoteRoot;
    }

    public onClosed(listener: () => void): () => void {
        this.closeListeners.add(listener);
        return () => this.closeListeners.delete(listener);
    }

    public closeChildConnections(): void {
        for (const remoteRoot of this.connections.values())
            if (remoteRoot.remoteRelation === "child") remoteRoot.close();
    }

    public closeConnections(): void {
        this.closeChildConnections();
        for (const transport of this.connections.keys()) transport.close(true);
        for (const listener of this.closeListeners) listener();
        this.closeListeners.clear();
    }
}
