import { UNKNOWN_STATE } from "./WebRTCConnectionTypes";
import type {
    WebRTCConnectionCallbacks,
    WebRTCConnectionFactory,
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress
} from "./WebRTCConnectionTypes";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import type { SerializedError } from "@/rpc/internal/errorWire";
import { deserializeError } from "@/rpc/internal/errorWire";
import type { WebRTCMainThreadBridgeRoot } from "@/rpc/internal/roots/WebRTCMainThreadBridge";
import type {
    WebRTCWorkerBridgeRoot,
    WebRTCWorkerBridgeRemoteRoot
} from "@/rpc/internal/roots/WebRTCWorkerBridgeRoot";

class ProxyRTCDataChannel implements WebRTCDataChannelLike {
    onmessage: ((event: { data: any }) => void) | null = null;
    onopen: ((event?: any) => void) | null = null;
    onclose: ((event?: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    readyState: string;

    constructor(
        private readonly remote: Pick<
            RuntimeConnection<WebRTCMainThreadBridgeRoot>,
            "negotiation"
        >,
        private readonly peerAddress: WebRTCPeerAddress,
        public readonly label?: string,
        readyState = "connecting"
    ) {
        this.readyState = readyState;
    }

    send(data: any): void {
        this.remote.negotiation.proxySend(this.peerAddress, data).send();
    }

    close(): void {
        if (this.readyState === "closed" || this.readyState === "closing") {
            return;
        }
        this.readyState = "closing";
        this.remote.negotiation.proxyClose(this.peerAddress).send();
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

class WorkerBridgeWebRTCConnectionFactory implements WebRTCConnectionFactory {
    private workerBridgeRemoteRoot?: WebRTCWorkerBridgeRemoteRoot;
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

    /** Bind the bridge created and owned by the RuntimeHost. */
    public attachBridge(remoteRoot: WebRTCWorkerBridgeRemoteRoot): void {
        this.workerBridgeRemoteRoot = remoteRoot;
        remoteRoot.onClosed(() => {
            if (!remoteRoot.isDisposing)
                for (const callbacks of this.callbacksByPeerAddress.values())
                    callbacks.onError?.(new Error("WebRTC bridge closed"));
            this.callbacksByPeerAddress.clear();
            this.proxyChannelsByPeerAddress.clear();
            this.workerBridgeRemoteRoot = undefined;
        });
    }

    private get remote(): RuntimeConnection<WebRTCWorkerBridgeRoot> {
        if (!this.workerBridgeRemoteRoot)
            throw new Error("WebRTC worker bridge is not initialized");
        return this.workerBridgeRemoteRoot.rpc;
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

    public transferredChannel(
        peerAddress: WebRTCPeerAddress,
        channel: WebRTCDataChannelLike
    ): void {
        this.callbacksByPeerAddress.get(peerAddress)?.onDataChannel(channel);
    }

    public proxyChannel(
        peerAddress: WebRTCPeerAddress,
        label?: string,
        readyState?: string
    ): void {
        const callbacks = this.callbacksByPeerAddress.get(peerAddress);
        if (!callbacks) return;
        const channel = new ProxyRTCDataChannel(
            this.remote,
            peerAddress,
            label,
            readyState
        );
        this.proxyChannelsByPeerAddress.set(peerAddress, channel);
        callbacks.onDataChannel(channel);
    }

    public state(
        peerAddress: WebRTCPeerAddress,
        state: WebRTCConnectionStateSnapshot
    ): void {
        this.stateByPeerAddress.set(peerAddress, state);
        this.callbacksByPeerAddress
            .get(peerAddress)
            ?.onConnectionStateChange(state);
    }

    public iceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: RTCIceCandidateInit
    ): void {
        this.callbacksByPeerAddress.get(peerAddress)?.onIceCandidate(candidate);
    }

    public error(peerAddress: WebRTCPeerAddress, error: SerializedError): void {
        this.callbacksByPeerAddress
            .get(peerAddress)
            ?.onError(deserializeError(error));
    }

    public proxyMessage(peerAddress: WebRTCPeerAddress, data: unknown): void {
        this.proxyChannelsByPeerAddress.get(peerAddress)?.emitMessage(data);
    }

    public proxyState(
        peerAddress: WebRTCPeerAddress,
        readyState: string,
        event: "open" | "close" | "error",
        error?: SerializedError
    ): void {
        const channel = this.proxyChannelsByPeerAddress.get(peerAddress);
        if (!channel) return;
        channel.emitState(
            event,
            readyState,
            error ? deserializeError(error) : undefined
        );
        if (event === "close")
            this.proxyChannelsByPeerAddress.delete(peerAddress);
    }
    createOffer(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        this.setCallbacks(peerAddress, callbacks);
        return this.remote.negotiation.createOffer(peerAddress).request();
    }

    acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        this.setCallbacks(peerAddress, callbacks);
        return this.remote.negotiation
            .acceptOffer(peerAddress, offer)
            .request();
    }

    applyAnswer(peerAddress: WebRTCPeerAddress, answer: any): Promise<void> {
        return this.remote.negotiation
            .applyAnswer(peerAddress, answer)
            .request();
    }

    addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        return this.remote.negotiation
            .addIceCandidate(peerAddress, candidate)
            .request();
    }

    close(peerAddress: WebRTCPeerAddress): Promise<void> {
        return this.remote.negotiation.close(peerAddress).request();
    }
}

export default WorkerBridgeWebRTCConnectionFactory;
