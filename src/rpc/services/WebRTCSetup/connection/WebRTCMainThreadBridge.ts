import {
    serializeBridgeError,
    WEBRTC_BRIDGE_NAMESPACE,
    type WebRTCBridgePortMessage,
    type WebRTCBridgeRequest
} from "./WebRTCBridgeProtocol";
import type {
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress,
    WebRTCPeerConnectionLike
} from "./WebRTCConnectionTypes";
import { loadWebRTCProvider, type WebRTCProvider } from "./WebRTCProvider";
import type { Logger } from "@/utils/logging/Logger";

export type WebRTCChannelMode = "auto" | "transfer" | "proxy";

export type WebRTCMainThreadBridgeOptions = {
    /**
     * How a freshly-created RTCDataChannel is handed to the worker:
     *  - "auto" (default): attempt to transfer the channel to the worker and,
     *    if the runtime can't transfer it, fall back to proxying its messages
     *    over the bridge.
     *  - "transfer": only transfer; throw if the runtime can't (strict).
     *  - "proxy": always proxy — use when transfer is known-unsupported
     *    (e.g. Firefox/Safari) or in tests.
     */
    channelMode?: WebRTCChannelMode;
    /**
     * Logger for bridge diagnostics on the main thread. Pass the logger
     * returned by `p2pSetup` so notices reach the SDK log pipeline instead of
     * the console.
     */
    logger?: Logger;
};

export type WebRTCMainThreadBridgeHandle = {
    dispose(): void;
};

type ConnectionRecord = {
    connection: WebRTCPeerConnectionLike;
    proxiedChannel?: WebRTCDataChannelLike;
};

class WebRTCMainThreadBridgeBroker {
    private provider?: WebRTCProvider;
    // Cached the first time "auto" mode attempts a transfer: once we learn the
    // runtime can't transfer channels we go straight to proxy for the rest.
    private channelTransferSupported?: boolean;
    private readonly connectionsByPeerAddress = new Map<
        WebRTCPeerAddress,
        ConnectionRecord
    >();

    constructor(
        private readonly port: MessagePort,
        private readonly options: WebRTCMainThreadBridgeOptions = {}
    ) {
        this.port.onmessage = (
            event: MessageEvent<WebRTCBridgePortMessage>
        ) => {
            void this.handleMessage(event.data);
        };
        this.port.start?.();
    }

    dispose(): void {
        for (const record of this.connectionsByPeerAddress.values()) {
            record.connection.close();
        }
        this.connectionsByPeerAddress.clear();
        this.port.close();
    }

    private async getProvider(): Promise<WebRTCProvider> {
        if (!this.provider) {
            this.provider = await loadWebRTCProvider();
        }
        return this.provider;
    }

    private post(message: WebRTCBridgePortMessage, transfer?: Transferable[]) {
        this.port.postMessage(message, transfer || []);
    }

    private getSnapshot(
        connection: WebRTCPeerConnectionLike
    ): WebRTCConnectionStateSnapshot {
        return {
            connectionState: connection.connectionState || "unknown",
            iceState: connection.iceConnectionState || "unknown"
        };
    }

    private async handleMessage(
        message: WebRTCBridgePortMessage
    ): Promise<void> {
        if (!message || message.namespace !== WEBRTC_BRIDGE_NAMESPACE) return;

        if (message.type === "proxySend") {
            this.connectionsByPeerAddress
                .get(message.peerAddress)
                ?.proxiedChannel?.send(message.data);
            return;
        }

        if (message.type === "proxyClose") {
            this.connectionsByPeerAddress
                .get(message.peerAddress)
                ?.proxiedChannel?.close();
            return;
        }

        if (message.type !== "request") return;

        try {
            const result = await this.handleRequest(message.request);
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "response",
                requestId: message.requestId,
                ok: true,
                result
            });
        } catch (error) {
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "response",
                requestId: message.requestId,
                ok: false,
                error: serializeBridgeError(error)
            });
        }
    }

    private async handleRequest(request: WebRTCBridgeRequest): Promise<any> {
        if (request.method === "createOffer") {
            return this.createOffer(request.peerAddress);
        }
        if (request.method === "acceptOffer") {
            return this.acceptOffer(request.peerAddress, request.offer);
        }
        if (request.method === "applyAnswer") {
            return this.applyAnswer(request.peerAddress, request.answer);
        }
        if (request.method === "addIceCandidate") {
            return this.addIceCandidate(request.peerAddress, request.candidate);
        }
        if (request.method === "close") {
            return this.close(request.peerAddress);
        }
        throw new Error(
            `Unknown WebRTC bridge request method: ${
                (request as { method?: string }).method
            }`
        );
    }

    private async createConnectionRecord(
        peerAddress: WebRTCPeerAddress
    ): Promise<ConnectionRecord> {
        this.close(peerAddress);

        const { RTCPeerConnection } = await this.getProvider();
        const connection = new RTCPeerConnection();
        const record: ConnectionRecord = { connection };

        const notifyState = () => {
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "state",
                peerAddress,
                state: this.getSnapshot(connection)
            });
        };

        connection.onconnectionstatechange = notifyState;
        connection.oniceconnectionstatechange = notifyState;
        connection.onicecandidate = (event: { candidate?: any }) => {
            if (!event.candidate) return;
            const candidate =
                typeof event.candidate.toJSON === "function"
                    ? event.candidate.toJSON()
                    : event.candidate;
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "iceCandidate",
                peerAddress,
                candidate
            });
        };

        this.connectionsByPeerAddress.set(peerAddress, record);

        return record;
    }

    private async createOffer(peerAddress: WebRTCPeerAddress): Promise<any> {
        const record = await this.createConnectionRecord(peerAddress);
        const connection = record.connection;
        const channel = connection.createDataChannel("webRTC-DataChannel");
        try {
            this.postChannel(peerAddress, record, channel);
        } catch (error) {
            this.connectionsByPeerAddress.delete(peerAddress);
            connection.close();
            throw error;
        }

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        return offer;
    }

    private async acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any
    ): Promise<any> {
        const record = await this.createConnectionRecord(peerAddress);
        const connection = record.connection;
        connection.ondatachannel = (event) => {
            try {
                this.postChannel(peerAddress, record, event.channel);
            } catch (error) {
                this.connectionsByPeerAddress.delete(peerAddress);
                connection.close();
                this.post({
                    namespace: WEBRTC_BRIDGE_NAMESPACE,
                    type: "error",
                    peerAddress,
                    error: serializeBridgeError(error)
                });
            }
        };

        await connection.setRemoteDescription(offer);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        return answer;
    }

    private async applyAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: any
    ): Promise<void> {
        const connection =
            this.connectionsByPeerAddress.get(peerAddress)?.connection;
        if (!connection) return;
        await connection.setRemoteDescription(answer);
    }

    private async addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        const connection =
            this.connectionsByPeerAddress.get(peerAddress)?.connection;
        if (!connection) return;

        const { RTCIceCandidate } = await this.getProvider();
        const normalizedCandidate = RTCIceCandidate
            ? new RTCIceCandidate(candidate)
            : candidate;
        await connection.addIceCandidate(normalizedCandidate);
    }

    private close(peerAddress: WebRTCPeerAddress): void {
        const record = this.connectionsByPeerAddress.get(peerAddress);
        if (!record) return;
        this.connectionsByPeerAddress.delete(peerAddress);
        record.proxiedChannel?.close();
        record.connection.close();
    }

    private postChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        if (this.shouldProxyChannel()) {
            this.postProxyChannel(peerAddress, record, channel);
            return;
        }

        const transferredMessage: WebRTCBridgePortMessage = {
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "channel",
            peerAddress,
            mode: "transferred",
            channel
        };

        try {
            this.post(transferredMessage, [channel as unknown as Transferable]);
            this.channelTransferSupported = true;
            return;
        } catch (error) {
            this.channelTransferSupported = false;
            if ((this.options.channelMode ?? "auto") === "transfer") {
                throw error;
            }
            // Surface the reason once (subsequent channels skip the attempt via
            // shouldProxyChannel) so a transfer-unsupported runtime is visible
            // rather than silently degrading.
            this.options.logger?.warn(
                "[peer3:webrtc-bridge] RTCDataChannel transfer is unsupported in this runtime; " +
                    "falling back to proxying channel messages over the bridge.",
                error
            );
        }

        this.postProxyChannel(peerAddress, record, channel);
    }

    private shouldProxyChannel(): boolean {
        const channelMode = this.options.channelMode ?? "auto";
        if (channelMode === "proxy") return true;
        if (channelMode === "transfer") return false;
        // "auto": once a transfer attempt has failed, never attempt again.
        return this.channelTransferSupported === false;
    }

    private postProxyChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        record.proxiedChannel = channel;
        this.wireProxyChannel(peerAddress, record, channel);
        this.post({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "channel",
            peerAddress,
            mode: "proxy",
            label: channel.label,
            readyState: channel.readyState
        });
    }

    private wireProxyChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        const isCurrentChannel = () =>
            this.connectionsByPeerAddress.get(peerAddress) === record &&
            record.proxiedChannel === channel;

        channel.onmessage = (event: { data: any }) => {
            if (!isCurrentChannel()) return;
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "proxyMessage",
                peerAddress,
                data: event.data
            });
        };
        channel.onopen = () => {
            if (!isCurrentChannel()) return;
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "proxyState",
                peerAddress,
                readyState: channel.readyState || "open",
                event: "open"
            });
        };
        channel.onclose = () => {
            if (!isCurrentChannel()) return;
            delete record.proxiedChannel;
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "proxyState",
                peerAddress,
                readyState: channel.readyState || "closed",
                event: "close"
            });
        };
        channel.onerror = (error: any) => {
            if (!isCurrentChannel()) return;
            this.post({
                namespace: WEBRTC_BRIDGE_NAMESPACE,
                type: "proxyState",
                peerAddress,
                readyState: channel.readyState || "closed",
                event: "error",
                error: serializeBridgeError(error)
            });
        };
    }
}

type BrokerRegistration = {
    broker: WebRTCMainThreadBridgeBroker;
    handleCount: number;
};

const brokersByPort = new WeakMap<MessagePort, BrokerRegistration>();

/**
 * Bind a WebRTC main-thread bridge to the `port` surfaced by `p2pSetup` on
 * `P2pInstance.webRTCBridgePort`. Call this on the real main thread (where
 * `RTCPeerConnection` lives) after forwarding the port up through any worker
 * nesting; the broker then drives `RTCPeerConnection` for the worker — however
 * deeply nested — that negotiates WebRTC over the channel.
 */
export function installWebRTCMainThreadBridge(
    port: MessagePort,
    options: WebRTCMainThreadBridgeOptions = {}
): WebRTCMainThreadBridgeHandle {
    // Installing on the same port more than once (nested setups, an effect
    // re-run) shares one broker — a second would clobber its `onmessage`.
    // Ref-count the handles so one handle's dispose (e.g. a stale cleanup)
    // can't close the bridge out from under a still-active owner: only the last
    // outstanding handle tears the broker down.
    const registration = brokersByPort.get(port) ?? {
        broker: new WebRTCMainThreadBridgeBroker(port, options),
        handleCount: 0
    };
    registration.handleCount++;
    brokersByPort.set(port, registration);

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            registration.handleCount--;
            if (registration.handleCount > 0) return;
            brokersByPort.delete(port);
            registration.broker.dispose();
        }
    };
}
