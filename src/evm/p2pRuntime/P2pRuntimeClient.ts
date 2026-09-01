import { ethers, type InterfaceAbi } from "ethers";
import { StateChannelManagerInterface } from "@typechain-types";

import { maybeStampErrorWithPeerAddress } from "@/utils/errorPeerAddress";
import { deserializeError, type SerializedError } from "@/rpc/serializeError";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { Address } from "@/types/types";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import type { Logger } from "@/utils";
import ClientP2pSigner from "../signer/ClientP2pSigner";
import ClientChainSigner from "../signer/ClientChainSigner";
import {
    attachContractEvents,
    EventBus,
    type BusKind
} from "@/events/EventBus";
import {
    P2pRuntimeClientRoot,
    P2P_RUNTIME_CLIENT_MANIFEST,
    type RuntimeEventSink
} from "./rpc/P2pRuntimeClientRoot";
import {
    P2P_RUNTIME_HOST_MANIFEST,
    type P2pRuntimeHostRoot
} from "./rpc/P2pRuntimeHostRoot";
import type { RuntimePort, SerializedContract } from "./types";

/** the host's services as the client calls them */
export type RuntimeHostEndpoint = RemoteRpcServices<P2pRuntimeHostRoot>;

export interface P2pRuntimeClientOptions {
    /** Address of the signer that authors transactions in the host. */
    signerAddress: Address;
    /** Serialized state machine contract rebuilt main-thread for app usage. */
    stateMachine: SerializedContract;
    /** Serialized real-chain SCM rebuilt with the host-backed chain signer. */
    scm: SerializedContract;
    /** Main-thread provider used for reads and native transaction responses. */
    provider: ethers.Provider;
    /** Sink for bus listener/adapter failures (e.g. a failed mirror emit). */
    logger?: Logger;
    /** Invoked after the port is closed (e.g. to terminate a worker). */
    onClose?: () => void | Promise<void>;
    /** register the host as a child on this realm's log tree. threaded hosts
     *  only - an inline host is on this same bus, so a link would loop a round
     *  back here. */
    openLogControlPort?: boolean;
    /**
     * the main-thread end of the WebRTC bridge channel whose other end went to
     * the worker with the bootstrap. kept only if the host says it registered
     * the bridge; closed otherwise. threaded only.
     */
    webRTCBridgeCandidate?: MessagePort;
}

/**
 * Main-thread half of the runtime. Owns one {@link RuntimePort} through a port
 * router, holds a typed endpoint for the host's services, serves the host's
 * pushes (bus events, host errors, log control), and exposes a
 * {@link ClientP2pSigner} plus a main-thread contract instance to the app.
 *
 * Works identically whether the host is inline (same process) or inside a
 * worker thread.
 */
class P2pRuntimeClient<T = ethers.Contract> implements RuntimeEventSink {
    private static readonly DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

    readonly signer: ClientP2pSigner;
    readonly contract: T;
    readonly chainSigner: ClientChainSigner;
    readonly stateChannelManagerContract: StateChannelManagerInterface;
    /** settles with the `deployComplete` reply, or with a host error before it */
    readonly ready: Promise<void>;
    /** the host's services; every call targets the host */
    readonly host: RuntimeHostEndpoint;

    /**
     * Main-thread end of the WebRTC bridge port, kept when the host runs in a
     * worker that can't negotiate WebRTC itself. Set once `deployComplete`
     * reports the bridge in use; undefined when the host negotiates WebRTC
     * locally.
     */
    webRTCBridgePort?: MessagePort;

    private readonly router: PortRpcRouter<P2pRuntimeClientRoot>;
    private readonly transport: MessagePortTransport;
    private readonly signerAddress: Address;
    readonly events: EventBus;
    private readonly hostErrorListeners = new Set<(error: Error) => void>();
    private readonly onClose?: () => void | Promise<void>;
    private readonly bridgeCandidate?: MessagePort;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;
    private readySettled = false;
    private disposed = false;
    private removeLink?: () => void;

    constructor(port: RuntimePort, options: P2pRuntimeClientOptions) {
        this.events = new EventBus((kind, eventName, error) =>
            options.logger?.error("Event bus listener failed", {
                kind,
                eventName,
                error: error instanceof Error ? error.message : String(error)
            })
        );
        this.signerAddress = options.signerAddress;
        this.onClose = options.onClose;
        this.bridgeCandidate = options.webRTCBridgeCandidate;
        this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });

        this.router = new PortRpcRouter<P2pRuntimeClientRoot>(
            (self) => new P2pRuntimeClientRoot(self, this, options.logger),
            options.logger,
            {
                defaultTimeoutMs: P2pRuntimeClient.DEFAULT_REQUEST_TIMEOUT_MS,
                onClosed: (_transport, isExpected) => {
                    if (!isExpected) this.handlePortClosed();
                }
            }
        );
        this.transport = this.router.attach(port);
        this.host = this.router.endpoint<P2pRuntimeHostRoot>(
            this.transport,
            P2P_RUNTIME_HOST_MANIFEST
        );

        this.signer = new ClientP2pSigner(this.host, options.signerAddress);
        this.chainSigner = new ClientChainSigner(
            this.host,
            options.provider,
            options.signerAddress.toString()
        );
        this.stateChannelManagerContract = connectStateChannelManager(
            options.scm.address,
            this.chainSigner,
            JSON.parse(options.scm.abiJson) as InterfaceAbi
        );
        const contract = new ethers.Contract(
            options.stateMachine.address,
            JSON.parse(options.stateMachine.abiJson),
            this.signer
        );
        this.contract = contract as T;
        // The main-thread contract mirror: the same helper worker code uses.
        // Events are forwarded as { name, args } and re-emitted by event name,
        // so name-based and unindexed `contract.filters.X()` subscriptions
        // receive them. A subscription that filters on an indexed argument
        // (`contract.filters.X(indexedValue)`) resolves to a different ethers
        // tag and will NOT match — the original topics aren't forwarded.
        // A failed mirror emit reports through the bus error reporter.
        attachContractEvents(contract, this.events, undefined, {
            runtimeOwned: true
        });

        if (options.openLogControlPort && options.logger) {
            // host is a child -> its peer identity stays off the shared main realm
            this.removeLink = options.logger.addLogLink({
                id: `sdk:${String(options.signerAddress)}`,
                transport: this.transport,
                router: this.router,
                remoteRealm: "child",
                ownerLogger: options.logger
            });
        }
    }

    private handlePortClosed(): void {
        if (this.disposed) return;
        this.dropLink();
        const error = new Error("P2P runtime host closed the connection");
        for (const listener of this.hostErrorListeners) listener(error);
        void this.dispose();
    }

    /**
     * Both local state machines are deployed: have the host build the runtime.
     * The reply is the host's readiness, so `ready` settles with it.
     */
    async deployComplete(
        localStateMachineAddress: string,
        diamondStateMachineAddress: string
    ): Promise<void> {
        const { webRTCBridge } = await this.host.lifecycle
            .deployComplete(
                localStateMachineAddress,
                diamondStateMachineAddress
            )
            .request();
        if (webRTCBridge) {
            this.webRTCBridgePort = this.bridgeCandidate;
        } else {
            this.bridgeCandidate?.close();
        }
        if (!this.readySettled) {
            this.readySettled = true;
            this.resolveReady();
        }
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
        const serialized = await this.host.lifecycle
            .quiesce()
            .request({ timeoutMs: null });
        return serialized.map(deserializeError);
    }

    /** Tear down the runtime: dispose the host, reject pending work, close. */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        // Send the dispose request before flipping `disposed` so the line is
        // still open — the host needs it to gracefully close its
        // transport/timers before the worker exits.
        try {
            // Disposal owns its cleanup bounds. The generic request timeout can
            // otherwise force shutdown while provider/DHT handles are still
            // closing, which can make Node abort in uv_loop_close().
            await this.host.lifecycle.dispose().request({ timeoutMs: null });
        } catch {
            // The host may already be gone; proceed with local teardown.
        }
        this.disposed = true;
        this.dropLink();
        this.bridgeCandidate?.close();
        this.transport.close(true);
        await this.onClose?.();
    }

    // ----- what the host pushes -----

    onBusEvent(kind: BusKind, eventName: string, args: unknown[]): void {
        this.events.emit(kind, eventName, args);
    }

    onHostErrorPushed(error: Error): void {
        if (!this.readySettled) {
            this.readySettled = true;
            this.rejectReady(error);
            return;
        }

        if (this.hostErrorListeners.size === 0) {
            // No orchestrator hook: surface as a main-thread unhandled rejection
            // (matches an inline host throwing in its own event loop).
            void Promise.reject(error);
            return;
        }
        for (const listener of this.hostErrorListeners) listener(error);
    }

    /**
     * Two faces of one name. The app subscribes to autonomous host-side errors
     * (worker unhandledRejection / uncaughtException funnelled over the port)
     * and gets an unsubscribe fn; the host's `runtimeEvents` service pushes
     * one. With no subscriber, a pushed error is re-thrown as a main-thread
     * unhandled rejection, so it surfaces the same way an inline host's error
     * would.
     */
    onHostError(error: SerializedError): void;
    onHostError(listener: (error: Error) => void): () => void;
    onHostError(
        arg: SerializedError | ((error: Error) => void)
    ): void | (() => void) {
        if (typeof arg === "function") {
            this.hostErrorListeners.add(arg);
            return () => this.hostErrorListeners.delete(arg);
        }
        const error = deserializeError(arg);
        // deserializeError only restores a stamp the wire carried - hostError
        // comes from a worker, which never stamps -> attribute it here (the
        // whole worker is this one peer)
        maybeStampErrorWithPeerAddress(error, String(this.signerAddress));
        this.onHostErrorPushed(error);
    }

    private dropLink(): void {
        this.removeLink?.();
        this.removeLink = undefined;
    }
}

export default P2pRuntimeClient;
