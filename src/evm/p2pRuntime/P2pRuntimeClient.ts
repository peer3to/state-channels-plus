import { ethers } from "ethers";
import {
    StateChannelManagerInterface,
    StateChannelManagerInterface__factory
} from "@typechain-types";

import { maybeStampErrorWithPeerAddress } from "@/utils/errorPeerAddress";
import type { Address } from "@/types/types";
import type { Logger } from "@/utils";
import ClientP2pSigner from "../signer/ClientP2pSigner";
import ClientChainSigner from "../signer/ClientChainSigner";
import { attachContractEvents, EventBus } from "@/events/EventBus";
import type {
    RuntimeBusEventMessage,
    RuntimeClientRequest,
    RuntimeHostErrorMessage,
    RuntimeHostMessage,
    RuntimePort,
    RuntimeRequestInput,
    RuntimeResponse,
    SerializedContract,
    SerializedError
} from "./types";

function restoreEthersErrorMetadata(
    error: Error,
    serialized: SerializedError
): void {
    // Error's standard fields cross the port, but ethers' enumerable metadata
    // does not. Restore the plain fields callers use for error classification;
    // transaction, receipt, and info remain serializable projections.
    Object.assign(error, {
        code: serialized.code,
        shortMessage: serialized.shortMessage,
        info: serialized.info,
        action: serialized.action,
        reason: serialized.reason,
        transaction: serialized.transaction,
        receipt: serialized.receipt
    });
}

function deserializeError(serialized: SerializedError): Error {
    const error = new Error(serialized.message);
    error.name = serialized.name ?? error.name;
    if (serialized.stack) error.stack = serialized.stack;
    // Restore a contract revert's `.data` so `tryDecodeCustomError` can decode
    // custom errors that crossed the port.
    if (serialized.data !== undefined) {
        (error as Error & { data?: string }).data = serialized.data;
    }
    restoreEthersErrorMetadata(error, serialized);
    // Restore the originating-peer stamp (the non-enumerable in-process
    // property doesn't survive the structured-clone hop across the port).
    maybeStampErrorWithPeerAddress(error, serialized.peerAddress);
    return error;
}

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
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Main-thread half of the runtime. Owns one {@link RuntimePort}, correlates
 * requests/responses, replays p2p event hooks and contract events, and exposes
 * a {@link ClientP2pSigner} plus a main-thread contract instance to the app.
 *
 * Works identically whether the host is inline (same process) or inside a
 * worker thread.
 */
class P2pRuntimeClient<T = ethers.Contract> {
    private static readonly DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

    readonly signer: ClientP2pSigner;
    readonly contract: T;
    readonly chainSigner: ClientChainSigner;
    readonly stateChannelManagerContract: StateChannelManagerInterface;
    readonly ready: Promise<void>;

    /**
     * Main-thread end of the WebRTC bridge port, handed over by the host when it
     * runs in a worker that can't negotiate WebRTC itself. Arrives before
     * `ready` resolves; undefined when the host negotiates WebRTC locally.
     */
    webRTCBridgePort?: MessagePort;

    private readonly port: RuntimePort;
    private readonly signerAddress: Address;
    private readonly pending = new Map<number, PendingRequest>();
    private nextRequestId = 1;
    readonly events: EventBus;
    private readonly hostErrorListeners = new Set<(error: Error) => void>();
    private readonly onClose?: () => void | Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;
    private readySettled = false;
    private disposed = false;

    constructor(port: RuntimePort, options: P2pRuntimeClientOptions) {
        this.events = new EventBus((kind, eventName, error) =>
            options.logger?.error("Event bus listener failed", {
                kind,
                eventName,
                error: error instanceof Error ? error.message : String(error)
            })
        );
        this.port = port;
        this.signerAddress = options.signerAddress;
        this.onClose = options.onClose;
        this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });

        this.signer = new ClientP2pSigner(this, options.signerAddress);
        this.chainSigner = new ClientChainSigner(
            this,
            options.provider,
            options.signerAddress.toString()
        );
        this.stateChannelManagerContract =
            StateChannelManagerInterface__factory.connect(
                options.scm.address,
                this.chainSigner
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

        this.port.onMessage((message) =>
            this.handleMessage(message as RuntimeHostMessage)
        );
        this.port.onClose(() => this.handlePortClosed());
        this.port.start();
    }

    private handlePortClosed(): void {
        if (this.disposed) return;
        const error = new Error("P2P runtime host closed the connection");
        for (const listener of this.hostErrorListeners) listener(error);
        void this.dispose();
    }

    /** Send a request to the host; rejects on host error or after `timeoutMs`. */
    request<TResult>(
        request: RuntimeRequestInput,
        options?: { timeoutMs?: number | null }
    ): Promise<TResult> {
        if (this.disposed) {
            return Promise.reject(
                new Error("P2P runtime client has been disposed")
            );
        }
        const requestId = this.nextRequestId++;
        const message = { ...request, requestId } as RuntimeClientRequest;
        const timeoutMs =
            options?.timeoutMs === null
                ? null
                : (options?.timeoutMs ??
                  P2pRuntimeClient.DEFAULT_REQUEST_TIMEOUT_MS);
        return new Promise<TResult>((resolve, reject) => {
            const timeout =
                timeoutMs === null
                    ? undefined
                    : setTimeout(() => {
                          if (this.pending.delete(requestId)) {
                              reject(
                                  new Error(
                                      `P2P runtime request '${request.type}' timed out after ${timeoutMs}ms`
                                  )
                              );
                          }
                      }, timeoutMs);

            this.pending.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout
            });
            try {
                this.port.post(message);
            } catch (error) {
                if (this.pending.delete(requestId)) {
                    if (timeout) clearTimeout(timeout);
                    reject(error as Error);
                }
            }
        });
    }

    /**
     * Subscribe to autonomous host-side errors (worker unhandledRejection /
     * uncaughtException funnelled over the port). With no subscriber, such an
     * error is re-thrown as a main-thread unhandled rejection, so it surfaces
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
        const serialized = await this.request<SerializedError[]>(
            { type: "quiesce" },
            { timeoutMs: null }
        );
        return serialized.map(deserializeError);
    }

    /** Tear down the runtime: dispose the host, reject pending work, close. */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        // Send the dispose request before flipping `disposed` so it isn't
        // rejected by the guard in `request` — the host needs it to gracefully
        // close its transport/timers before the worker exits.
        try {
            // Disposal owns its cleanup bounds. The generic request timeout can
            // otherwise force shutdown while provider/DHT handles are still
            // closing, which can make Node abort in uv_loop_close().
            await this.request<void>({ type: "dispose" }, { timeoutMs: null });
        } catch {
            // The host may already be gone; proceed with local teardown.
        }
        this.disposed = true;
        this.rejectAllPending(new Error("P2P runtime client disposed"));
        this.port.close();
        await this.onClose?.();
    }

    private handleMessage(message: RuntimeHostMessage): void {
        switch (message.type) {
            case "ready":
                this.readySettled = true;
                this.resolveReady();
                return;
            case "response":
                this.handleResponse(message);
                return;
            case "busEvent":
                this.dispatchBusEvent(message);
                return;
            case "hostError":
                this.dispatchHostError(message);
                return;
            case "webRTCBridgePort":
                this.webRTCBridgePort = message.port;
                return;
        }
    }

    private dispatchHostError(message: RuntimeHostErrorMessage): void {
        const error = deserializeError(message.error);
        // deserializeError only restores a stamp the wire carried - hostError
        // comes from a worker, which never stamps -> attribute it here (the
        // whole worker is this one peer)
        maybeStampErrorWithPeerAddress(error, String(this.signerAddress));

        if (!this.readySettled) {
            this.readySettled = true;
            this.rejectReady(error);
            this.rejectAllPending(error);
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

    private dispatchBusEvent(message: RuntimeBusEventMessage): void {
        this.events.emit(message.kind, message.eventName, message.args);
    }

    private handleResponse(message: RuntimeResponse): void {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (pending.timeout) clearTimeout(pending.timeout);
        if (message.ok) {
            pending.resolve(message.result);
        } else {
            pending.reject(deserializeError(message.error));
        }
    }

    private rejectAllPending(reason: Error): void {
        for (const pending of this.pending.values()) {
            if (pending.timeout) clearTimeout(pending.timeout);
            pending.reject(reason);
        }
        this.pending.clear();
    }
}

export default P2pRuntimeClient;
