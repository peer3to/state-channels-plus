import { ethers } from "ethers";

import type { Address } from "@/types/types";
import ClientP2pSigner from "../signer/ClientP2pSigner";
import RuntimeEventEmitter, {
    type RuntimeEventMap,
    type RuntimeEventName
} from "./RuntimeEventEmitter";
import type {
    RuntimeClientRequest,
    RuntimeContractEventMessage,
    RuntimeEventHandlerMessage,
    RuntimeHostErrorMessage,
    RuntimeHostMessage,
    RuntimeP2pEventHookMessage,
    RuntimePort,
    RuntimeRequestInput,
    RuntimeResponse,
    SerializedContract,
    SerializedError
} from "./types";

function deserializeError(serialized: SerializedError): Error {
    const error = new Error(serialized.message);
    error.name = serialized.name ?? error.name;
    if (serialized.stack) error.stack = serialized.stack;
    // Restore a contract revert's `.data` so `tryDecodeCustomError` can decode
    // custom errors that crossed the port.
    if (serialized.data !== undefined) {
        (error as Error & { data?: string }).data = serialized.data;
    }
    return error;
}

export interface P2pRuntimeClientOptions {
    /** Address of the signer that authors transactions in the host. */
    signerAddress: Address;
    /** Serialized state machine contract rebuilt main-thread for app usage. */
    stateMachine: SerializedContract;
    /** Invoked after the port is closed (e.g. to terminate a worker). */
    onClose?: () => void | Promise<void>;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
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
    readonly ready: Promise<void>;

    /**
     * Main-thread end of the WebRTC bridge port, handed over by the host when it
     * runs in a worker that can't negotiate WebRTC itself. Arrives before
     * `ready` resolves; undefined when the host negotiates WebRTC locally.
     */
    webRTCBridgePort?: MessagePort;

    private readonly port: RuntimePort;
    private readonly pending = new Map<number, PendingRequest>();
    private nextRequestId = 1;
    private readonly events = new RuntimeEventEmitter();
    private readonly hostErrorListeners = new Set<(error: Error) => void>();
    private readonly onClose?: () => void | Promise<void>;
    private resolveReady!: () => void;
    private disposed = false;

    constructor(port: RuntimePort, options: P2pRuntimeClientOptions) {
        this.port = port;
        this.onClose = options.onClose;
        this.ready = new Promise<void>((resolve) => {
            this.resolveReady = resolve;
        });

        this.signer = new ClientP2pSigner(this, options.signerAddress);
        this.contract = new ethers.Contract(
            options.stateMachine.address,
            JSON.parse(options.stateMachine.abiJson),
            this.signer
        ) as T;

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
        options?: { timeoutMs?: number }
    ): Promise<TResult> {
        if (this.disposed) {
            return Promise.reject(
                new Error("P2P runtime client has been disposed")
            );
        }
        const requestId = this.nextRequestId++;
        const message = { ...request, requestId } as RuntimeClientRequest;
        const timeoutMs =
            options?.timeoutMs ?? P2pRuntimeClient.DEFAULT_REQUEST_TIMEOUT_MS;
        return new Promise<TResult>((resolve, reject) => {
            const timeout = setTimeout(() => {
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
                    clearTimeout(timeout);
                    reject(error as Error);
                }
            }
        });
    }

    /** Subscribe to a runtime event; returns an unsubscribe function. */
    on<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): () => void {
        return this.events.on(event, listener);
    }

    /** Remove a previously registered runtime-event listener. */
    off<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): void {
        this.events.off(event, listener);
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
        const serialized = await this.request<SerializedError[]>({
            type: "quiesce"
        });
        return serialized.map(deserializeError);
    }

    /** Tear down the runtime: dispose the host, reject pending work, close. */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        // Send the dispose request before flipping `disposed` so it isn't
        // rejected by the guard in `request` — the host needs it to gracefully
        // close its transport/timers before the worker is terminated.
        try {
            await this.request<void>({ type: "dispose" });
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
                this.resolveReady();
                return;
            case "response":
                this.handleResponse(message);
                return;
            case "p2pEventHook":
                this.dispatchP2pEventHook(message);
                return;
            case "contractEvent":
                this.dispatchContractEvent(message);
                return;
            case "eventHandlerInvoked":
                this.dispatchEventHandlerInvocation(message);
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

        if (this.hostErrorListeners.size === 0) {
            // No orchestrator hook: surface as a main-thread unhandled rejection
            // (matches an inline host throwing in its own event loop).
            void Promise.reject(error);
            return;
        }
        for (const listener of this.hostErrorListeners) listener(error);
    }

    private dispatchEventHandlerInvocation(
        message: RuntimeEventHandlerMessage
    ): void {
        this.events.emit(message.name, message.args);
    }

    private handleResponse(message: RuntimeResponse): void {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        clearTimeout(pending.timeout);
        if (message.ok) {
            pending.resolve(message.result);
        } else {
            pending.reject(deserializeError(message.error));
        }
    }

    private dispatchP2pEventHook(message: RuntimeP2pEventHookMessage): void {
        this.events.emit(message.name, message.args);
    }

    private dispatchContractEvent(message: RuntimeContractEventMessage): void {
        void (this.contract as unknown as ethers.Contract).emit(
            message.name,
            ...message.args
        );
    }

    private rejectAllPending(reason: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(reason);
        }
        this.pending.clear();
    }
}

export default P2pRuntimeClient;
