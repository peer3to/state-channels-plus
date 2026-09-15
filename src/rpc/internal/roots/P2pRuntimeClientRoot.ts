import { createRoot, type RootStartContext } from "../createRoot";
import {
    serializeError,
    deserializeError,
    type SerializedError
} from "../errorWire";
import {
    P2pRuntimeHostRoot,
    type P2pRuntimeHostRemoteRoot
} from "./P2pRuntimeHostRoot";
import {
    installWebRTCMainThreadBridge,
    type WebRTCMainThreadBridgeHandle
} from "./WebRTCMainThreadBridge";
import { SdkClientService } from "../services/sdkClient/SdkClientService";
import { EventBus } from "@/events/EventBus";
import type { P2pSetupDependencies } from "@/evm/p2pRuntime/setupP2pRuntime";
import type { SetupPayload } from "@/evm/p2pRuntime/types";
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { isWorkerRuntime } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCProvider";
import type { Address } from "@/types/types";
import { errorMessage } from "@/utils/errorMessage";
import { maybeStampErrorWithPeerAddress } from "@/utils/errorPeerAddress";
import workerUrl from "@platform/p2pRuntimeHostRootUrl";

export interface ClientRootOptions {
    payload: SetupPayload;
    signerAddress: Address;
}

export interface ClientRootDependencies
    extends Pick<P2pSetupDependencies, "hostContext"> {}

/** Owns client communication with the SDK host. */
export class P2pRuntimeClientRoot extends AInternalRpcRoot {
    public readonly sdkClient: SdkClientService;
    public p2pRuntimeHostRemoteRoot?: P2pRuntimeHostRemoteRoot;
    public webRTCBridgePort?: MessagePort;
    public readonly events: EventBus;
    private readonly hostErrorListeners = new Set<(error: Error) => void>();
    private webRTCBridgeHandle?: WebRTCMainThreadBridgeHandle;
    private disposed = false;
    private hostAborted = false;
    private readonly signerAddress: Address;

    constructor(
        private readonly options: ClientRootOptions | undefined,
        private readonly dependencies: ClientRootDependencies = {},
        context: RootStartContext
    ) {
        if (!options)
            throw new Error("Client root requires host connection options");
        super(
            (error) => this.dispatchHostError(serializeError(error)),
            30_000,
            context
        );
        this.signerAddress = options.signerAddress;
        this.events = new EventBus((kind, eventName, error) =>
            this.logger.attachedLogger.error("Event bus listener failed", {
                kind,
                eventName,
                error: errorMessage(error)
            })
        );
        this.sdkClient = new SdkClientService(this.router, {
            busEvent: (kind, eventName, args) => {
                this.events.emit(kind, eventName, args);
                if (kind === "p2pEventHooks" && eventName === "onAbort")
                    this.hostAborted = true;
            },
            webRTCBridgePort: (port) => {
                this.webRTCBridgePort = port;
            }
        });
    }

    public async start(): Promise<void> {
        await this.connectHost(this.options!, this.dependencies);
    }

    private async connectHost(
        { payload }: ClientRootOptions,
        dependencies: ClientRootDependencies
    ): Promise<void> {
        const creation = createRoot(P2pRuntimeHostRoot, {
            parent: this,
            mode: payload.config.RUN_SDK_IN_THREAD ? "worker" : "inline",
            workerUrl,
            local: dependencies.hostContext,
            args: payload
        });
        this.p2pRuntimeHostRemoteRoot = await creation;
        this.p2pRuntimeHostRemoteRoot.onClosed(() => this.handlePortClosed());
    }

    private handlePortClosed(): void {
        if (this.disposed || this.p2pRuntimeHostRemoteRoot?.isDisposing) return;
        // Fatal child failures are delivered by RootErrorService with their original cause.
        if (!this.hostAborted && !this.p2pRuntimeHostRemoteRoot?.failure) {
            const error = new Error("P2P runtime host closed the connection");
            for (const listener of this.hostErrorListeners) listener(error);
        }
        void this.dispose();
    }

    /**
     * Subscribe to autonomous host-side errors (worker unhandledRejection /
     * uncaughtException funnelled over the port). With no subscriber, such an
     * error is re-thrown as a client-runtime unhandled rejection, so it surfaces
     * the same way an inline host's error would. Returns an unsubscribe fn.
     */
    onHostError(listener: (error: Error) => void): () => void {
        this.hostErrorListeners.add(listener);
        return () => this.hostErrorListeners.delete(listener);
    }

    /**
     * Drain the host's detached async work and return any rejections, so the
     * orchestrator can settle host-side work over the port regardless of where
     * the host runs.
     */
    async quiesce(): Promise<Error[]> {
        // The host-side detached-work drain owns its timeout and returns the
        // unresolved promise origins. A second client timeout at the same
        // boundary can hide that result by winning the race.
        const hostRemoteRoot = this.p2pRuntimeHostRemoteRoot!;
        if (this.hostAborted && hostRemoteRoot.isClosed) return [];
        try {
            const serialized = await hostRemoteRoot.quiesce();
            return serialized.map(deserializeError);
        } catch (error) {
            if (this.hostAborted && hostRemoteRoot.isClosed) return [];
            throw error;
        }
    }

    /** Tear down the runtime and release client-owned resources. */
    public async dispose(): Promise<void> {
        try {
            await this.disposeRoot(() => this.disposeClient());
        } catch {
            // The host may already be gone; local cleanup still runs.
        }
    }

    private disposeClient(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.webRTCBridgeHandle?.dispose();
        this.webRTCBridgeHandle = undefined;
        // A parented root closes its reply connection after the acknowledgement.
        if (
            ![...this.connections.values()].some(
                (remoteRoot) => remoteRoot.remoteRelation === "parent"
            )
        )
            this.closeConnections();
    }

    public installMainThreadBridgeIfOnMainThread(): void {
        if (
            this.webRTCBridgeHandle ||
            !this.webRTCBridgePort ||
            isWorkerRuntime()
        )
            return;
        this.webRTCBridgeHandle = installWebRTCMainThreadBridge(
            this.webRTCBridgePort,
            {
                logger: this.logger.attachedLogger.child({
                    component: "WebRTCMainThreadBridge"
                })
            }
        );
    }

    private dispatchHostError(serializedError: SerializedError): void {
        const error = deserializeError(serializedError);
        // deserializeError only restores a stamp the wire carried - this report
        // comes from a worker, which never stamps -> attribute it here (the
        // whole worker is this one peer)
        maybeStampErrorWithPeerAddress(error, String(this.signerAddress));

        if (this.hostErrorListeners.size === 0) {
            // No orchestrator hook: surface as a client-runtime unhandled rejection
            // (matches an inline host throwing in its own event loop).
            void Promise.reject(error);
            return;
        }
        for (const listener of this.hostErrorListeners) listener(error);
    }
}
