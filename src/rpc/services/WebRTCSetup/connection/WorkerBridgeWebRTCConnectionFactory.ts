import {
    deserializeBridgeError,
    WEBRTC_BRIDGE_NAMESPACE,
    type WebRTCBridgeInitMessage,
    type WebRTCBridgePortMessage,
    type WebRTCBridgeRequest
} from "./WebRTCBridgeProtocol";
import type {
    WebRTCConnectionCallbacks,
    WebRTCConnectionFactory,
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress
} from "./WebRTCConnectionTypes";

const UNKNOWN_STATE: WebRTCConnectionStateSnapshot = {
    connectionState: "unknown",
    iceState: "unknown"
};

// Worker→main bridge requests are local postMessage round-trips that normally
// settle in milliseconds. This bound only exists so a dropped/closed bridge can
// never leave an awaiting WebRTC setup call hanging forever.
const BRIDGE_REQUEST_TIMEOUT_MS = 30_000;

function isWorkerRuntime(): boolean {
    const runtime = globalThis as any;
    return (
        typeof runtime.WorkerGlobalScope !== "undefined" &&
        globalThis instanceof runtime.WorkerGlobalScope
    );
}

class ProxyRTCDataChannel implements WebRTCDataChannelLike {
    onmessage: ((event: { data: any }) => void) | null = null;
    onopen: ((event?: any) => void) | null = null;
    onclose: ((event?: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    readyState: string;

    constructor(
        private readonly port: MessagePort,
        private readonly peerAddress: WebRTCPeerAddress,
        public readonly label?: string,
        readyState = "connecting"
    ) {
        this.readyState = readyState;
    }

    send(data: any): void {
        this.port.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "proxySend",
            peerAddress: this.peerAddress,
            data
        } satisfies WebRTCBridgePortMessage);
    }

    close(): void {
        if (this.readyState === "closed" || this.readyState === "closing") {
            return;
        }
        this.readyState = "closing";
        this.port.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "proxyClose",
            peerAddress: this.peerAddress
        } satisfies WebRTCBridgePortMessage);
    }

    emitMessage(data: any): void {
        this.onmessage?.({ data });
    }

    emitState(
        event: "open" | "close" | "error",
        readyState: string,
        error?: Error
    ): void {
        this.readyState = readyState;
        if (event === "open") this.onopen?.();
        if (event === "close") this.onclose?.();
        if (event === "error")
            this.onerror?.(error || new Error("WebRTC proxy channel error"));
    }
}

class WebRTCWorkerBridgeClient {
    private nextRequestId = 1;
    private readonly pendingRequests = new Map<
        number,
        {
            resolve: (value: any) => void;
            reject: (error: Error) => void;
            timeoutId: ReturnType<typeof setTimeout>;
        }
    >();
    private readonly callbacksByPeerAddress = new Map<
        WebRTCPeerAddress,
        WebRTCConnectionCallbacks
    >();
    private readonly proxyChannelsByPeerAddress = new Map<
        WebRTCPeerAddress,
        ProxyRTCDataChannel
    >();
    private readonly stateByPeerAddress = new Map<
        WebRTCPeerAddress,
        WebRTCConnectionStateSnapshot
    >();

    constructor(private readonly port: MessagePort) {
        this.port.onmessage = (
            event: MessageEvent<WebRTCBridgePortMessage>
        ) => {
            this.handleMessage(event.data);
        };
        this.port.start?.();
    }

    setCallbacks(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): void {
        this.callbacksByPeerAddress.set(peerAddress, callbacks);
    }

    getState(peerAddress: WebRTCPeerAddress): WebRTCConnectionStateSnapshot {
        return this.stateByPeerAddress.get(peerAddress) || UNKNOWN_STATE;
    }

    request(
        request: WebRTCBridgeRequest,
        timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS
    ): Promise<any> {
        const requestId = this.nextRequestId++;
        const message: WebRTCBridgePortMessage = {
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "request",
            requestId,
            request
        };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (!this.pendingRequests.delete(requestId)) return;
                reject(
                    new Error(
                        `WebRTC bridge request "${request.method}" timed out after ${timeoutMs}ms`
                    )
                );
            }, timeoutMs);
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeoutId
            });
            this.port.postMessage(message);
        });
    }

    /**
     * Rejects every in-flight request and detaches the port. Called when the
     * bridge port is replaced or torn down so awaiting WebRTC setup calls fail
     * fast instead of hanging on a port that will never respond.
     */
    dispose(
        reason = "WebRTC bridge port closed before the request completed"
    ): void {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error(reason));
        }
        this.pendingRequests.clear();
        this.port.onmessage = null;
        this.port.close?.();
    }

    private handleMessage(message: WebRTCBridgePortMessage): void {
        if (!message || message.namespace !== WEBRTC_BRIDGE_NAMESPACE) return;

        if (message.type === "response") {
            const pending = this.pendingRequests.get(message.requestId);
            if (!pending) return;
            this.pendingRequests.delete(message.requestId);
            clearTimeout(pending.timeoutId);
            if (message.ok) {
                pending.resolve(message.result);
            } else {
                pending.reject(deserializeBridgeError(message.error));
            }
            return;
        }

        if (message.type === "channel") {
            const callbacks = this.callbacksByPeerAddress.get(
                message.peerAddress
            );
            if (!callbacks) return;

            if (message.mode === "transferred") {
                callbacks.onDataChannel(message.channel);
                return;
            }

            const channel = new ProxyRTCDataChannel(
                this.port,
                message.peerAddress,
                message.label,
                message.readyState
            );
            this.proxyChannelsByPeerAddress.set(message.peerAddress, channel);
            callbacks.onDataChannel(channel);
            return;
        }

        if (message.type === "state") {
            this.stateByPeerAddress.set(message.peerAddress, message.state);
            this.callbacksByPeerAddress
                .get(message.peerAddress)
                ?.onConnectionStateChange(message.state);
            return;
        }

        if (message.type === "iceCandidate") {
            this.callbacksByPeerAddress
                .get(message.peerAddress)
                ?.onIceCandidate(message.candidate);
            return;
        }

        if (message.type === "error") {
            this.callbacksByPeerAddress
                .get(message.peerAddress)
                ?.onError(deserializeBridgeError(message.error));
            return;
        }

        if (message.type === "proxyMessage") {
            this.proxyChannelsByPeerAddress
                .get(message.peerAddress)
                ?.emitMessage(message.data);
            return;
        }

        if (message.type === "proxyState") {
            const channel = this.proxyChannelsByPeerAddress.get(
                message.peerAddress
            );
            if (!channel) return;
            channel.emitState(
                message.event,
                message.readyState,
                message.error
                    ? deserializeBridgeError(message.error)
                    : undefined
            );
            if (message.event === "close") {
                this.proxyChannelsByPeerAddress.delete(message.peerAddress);
            }
        }
    }
}

class WorkerBridgeWebRTCConnectionFactory implements WebRTCConnectionFactory {
    private static instance?: WorkerBridgeWebRTCConnectionFactory;

    private bridgePort?: MessagePort;
    private client?: WebRTCWorkerBridgeClient;
    private receiverRegistered = false;
    private readonly bridgePortWaiters: Array<() => void> = [];

    static getInstance(): WorkerBridgeWebRTCConnectionFactory {
        if (!WorkerBridgeWebRTCConnectionFactory.instance) {
            WorkerBridgeWebRTCConnectionFactory.instance =
                new WorkerBridgeWebRTCConnectionFactory();
        }
        return WorkerBridgeWebRTCConnectionFactory.instance;
    }

    private constructor() {
        this.ensureReceiverRegistered();
    }

    registerPort(port: MessagePort): void {
        this.client?.dispose(
            "WebRTC bridge port was replaced before the request completed"
        );
        this.bridgePort = port;
        this.client = new WebRTCWorkerBridgeClient(port);

        while (this.bridgePortWaiters.length > 0) {
            this.bridgePortWaiters.shift()?.();
        }
    }

    hasPort(): boolean {
        this.ensureReceiverRegistered();
        return !!this.bridgePort;
    }

    async waitForPort(timeoutMs = 5000): Promise<boolean> {
        this.ensureReceiverRegistered();
        if (this.bridgePort) return true;

        return new Promise((resolve) => {
            let timeoutId: ReturnType<typeof setTimeout>;
            const waiter = () => {
                clearTimeout(timeoutId);
                resolve(true);
            };
            timeoutId = setTimeout(() => {
                const index = this.bridgePortWaiters.indexOf(waiter);
                if (index >= 0) this.bridgePortWaiters.splice(index, 1);
                resolve(false);
            }, timeoutMs);
            this.bridgePortWaiters.push(waiter);
        });
    }

    ensureReceiverRegistered(): void {
        if (this.receiverRegistered) return;

        if (!isWorkerRuntime()) return;

        const runtime = globalThis as any;
        if (typeof runtime.addEventListener !== "function") return;
        if (typeof runtime.removeEventListener !== "function") return;

        // Only latch the flag once we are actually attaching the listener, so a
        // premature main-thread call can't permanently suppress registration.
        this.receiverRegistered = true;

        const listener = ((event: MessageEvent) => {
            if (!this.isBridgeInitMessage(event.data)) return;
            const [port] = event.ports || [];
            if (!port) return;
            this.registerPort(port);
            runtime.removeEventListener("message", listener);
        }) as EventListener;

        runtime.addEventListener("message", listener);
    }

    private getClient(): WebRTCWorkerBridgeClient {
        if (!this.client) {
            throw new Error(
                "WebRTC worker bridge port is not registered. Call installWebRTCMainThreadBridge(worker) on the main thread before starting WebRTC setup."
            );
        }
        return this.client;
    }

    private isBridgeInitMessage(data: any): data is WebRTCBridgeInitMessage {
        return (
            data &&
            data.namespace === WEBRTC_BRIDGE_NAMESPACE &&
            data.type === "init"
        );
    }

    createOffer(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        const client = this.getClient();
        client.setCallbacks(peerAddress, callbacks);
        return client.request({
            method: "createOffer",
            peerAddress
        });
    }

    acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        const client = this.getClient();
        client.setCallbacks(peerAddress, callbacks);
        return client.request({
            method: "acceptOffer",
            peerAddress,
            offer
        });
    }

    applyAnswer(peerAddress: WebRTCPeerAddress, answer: any): Promise<void> {
        return this.getClient().request({
            method: "applyAnswer",
            peerAddress,
            answer
        });
    }

    addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        return this.getClient().request({
            method: "addIceCandidate",
            peerAddress,
            candidate
        });
    }

    close(peerAddress: WebRTCPeerAddress): Promise<void> {
        return this.getClient().request({
            method: "close",
            peerAddress
        });
    }

    getState(peerAddress: WebRTCPeerAddress): WebRTCConnectionStateSnapshot {
        return this.client?.getState(peerAddress) || UNKNOWN_STATE;
    }
}

if (isWorkerRuntime()) {
    WorkerBridgeWebRTCConnectionFactory.getInstance();
}

export default WorkerBridgeWebRTCConnectionFactory;
