import {
    serializeBridgeError,
    WEBRTC_BRIDGE_NAMESPACE,
    type WebRTCBridgeInitMessage,
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

export type WebRTCMainThreadBridgeOptions = {
    allowProxyFallback?: boolean;
};

export type WebRTCMainThreadBridgeHandle = {
    dispose(): void;
};

export type WebRTCBridgeWorkerTarget = {
    postMessage(message: any, transfer?: Transferable[]): void;
};

type ConnectionRecord = {
    connection: WebRTCPeerConnectionLike;
    proxiedChannel?: WebRTCDataChannelLike;
};

class WebRTCMainThreadBridgeBroker {
    private provider?: WebRTCProvider;
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
            this.handleMessage(event.data);
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
        if (request.method === "getState") {
            return this.getState(request.peerAddress);
        }
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

    private getState(
        peerAddress: WebRTCPeerAddress
    ): WebRTCConnectionStateSnapshot {
        const connection =
            this.connectionsByPeerAddress.get(peerAddress)?.connection;
        if (!connection) {
            return { connectionState: "unknown", iceState: "unknown" };
        }
        return this.getSnapshot(connection);
    }

    private postChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        const transferredMessage: WebRTCBridgePortMessage = {
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "channel",
            peerAddress,
            mode: "transferred",
            channel
        };

        try {
            this.post(transferredMessage, [channel as unknown as Transferable]);
            return;
        } catch (error) {
            if (!this.options.allowProxyFallback) {
                throw error;
            }
        }

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

const brokersByWorker = new WeakMap<
    WebRTCBridgeWorkerTarget,
    WebRTCMainThreadBridgeBroker
>();

export function installWebRTCMainThreadBridge(
    worker: WebRTCBridgeWorkerTarget,
    options: WebRTCMainThreadBridgeOptions = {}
): WebRTCMainThreadBridgeHandle {
    const existingBroker = brokersByWorker.get(worker);
    if (existingBroker) {
        return {
            dispose: () => {
                brokersByWorker.delete(worker);
                existingBroker.dispose();
            }
        };
    }

    const channel = new MessageChannel();
    const broker = new WebRTCMainThreadBridgeBroker(channel.port1, options);
    brokersByWorker.set(worker, broker);

    const initMessage: WebRTCBridgeInitMessage = {
        namespace: WEBRTC_BRIDGE_NAMESPACE,
        type: "init"
    };
    worker.postMessage(initMessage, [channel.port2]);

    return {
        dispose: () => {
            brokersByWorker.delete(worker);
            broker.dispose();
        }
    };
}
