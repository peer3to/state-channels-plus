import {
    WebRTCConnectionCallbacks,
    WebRTCConnectionFactory,
    WebRTCConnectionStateSnapshot,
    WebRTCPeerAddress,
    WebRTCPeerConnectionLike
} from "./WebRTCConnectionTypes";
import { loadWebRTCProvider, type WebRTCProvider } from "./WebRTCProvider";

const UNKNOWN_STATE: WebRTCConnectionStateSnapshot = {
    connectionState: "unknown",
    iceState: "unknown"
};

class LocalWebRTCConnectionFactory implements WebRTCConnectionFactory {
    private provider?: WebRTCProvider;
    private readonly connectionMap = new Map<
        WebRTCPeerAddress,
        WebRTCPeerConnectionLike
    >();

    constructor(provider?: WebRTCProvider) {
        this.provider = provider;
    }

    private async getProvider(): Promise<WebRTCProvider> {
        if (!this.provider) {
            this.provider = await loadWebRTCProvider();
        }
        return this.provider;
    }

    private getSnapshot(
        connection: WebRTCPeerConnectionLike
    ): WebRTCConnectionStateSnapshot {
        return {
            connectionState: connection.connectionState || "unknown",
            iceState: connection.iceConnectionState || "unknown"
        };
    }

    private async createConnection(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<WebRTCPeerConnectionLike> {
        const { RTCPeerConnection } = await this.getProvider();
        const existingConnection = this.connectionMap.get(peerAddress);
        existingConnection?.close();

        const connection = new RTCPeerConnection();
        this.connectionMap.set(peerAddress, connection);

        connection.onicecandidate = (event: { candidate?: any }) => {
            if (!event.candidate) return;
            // Normalize to a plain init dict so JSON.stringify downstream
            // produces a candidate the remote can reconstruct across engines.
            const candidate =
                typeof event.candidate.toJSON === "function"
                    ? event.candidate.toJSON()
                    : event.candidate;
            callbacks.onIceCandidate(candidate);
        };

        const notifyState = () => {
            callbacks.onConnectionStateChange(this.getSnapshot(connection));
        };

        connection.onconnectionstatechange = notifyState;
        connection.oniceconnectionstatechange = notifyState;

        return connection;
    }

    async createOffer(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        const connection = await this.createConnection(peerAddress, callbacks);

        const channel = connection.createDataChannel("webRTC-DataChannel");
        callbacks.onDataChannel(channel);

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        return offer;
    }

    async acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any> {
        const connection = await this.createConnection(peerAddress, callbacks);

        connection.ondatachannel = (event) => {
            callbacks.onDataChannel(event.channel);
        };

        await connection.setRemoteDescription(offer);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        return answer;
    }

    async applyAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: any
    ): Promise<void> {
        const connection = this.connectionMap.get(peerAddress);
        if (!connection) return;
        await connection.setRemoteDescription(answer);
    }

    async addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        const connection = this.connectionMap.get(peerAddress);
        if (!connection) return;

        const { RTCIceCandidate } = await this.getProvider();
        const normalizedCandidate = RTCIceCandidate
            ? new RTCIceCandidate(candidate)
            : candidate;
        await connection.addIceCandidate(normalizedCandidate);
    }

    async close(peerAddress: WebRTCPeerAddress): Promise<void> {
        const connection = this.connectionMap.get(peerAddress);
        if (!connection) return;
        this.connectionMap.delete(peerAddress);
        connection.close();
    }

    getState(peerAddress: WebRTCPeerAddress): WebRTCConnectionStateSnapshot {
        const connection = this.connectionMap.get(peerAddress);
        if (!connection) return UNKNOWN_STATE;
        return this.getSnapshot(connection);
    }
}

export default LocalWebRTCConnectionFactory;
