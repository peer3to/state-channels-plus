import { UNKNOWN_STATE } from "./WebRTCConnectionTypes";
import {
    WebRTCConnectionCallbacks,
    WebRTCConnectionFactory,
    WebRTCConnectionStateSnapshot,
    WebRTCPathStats,
    WebRTCPeerAddress,
    WebRTCPeerConnectionLike
} from "./WebRTCConnectionTypes";
import { loadWebRTCProvider, type WebRTCProvider } from "./WebRTCProvider";

/**
 * The selected candidate pair of `connection` and its transport, from
 * `getStats()`. Undefined without `getStats()`.
 */
async function readPathStats(
    connection: WebRTCPeerConnectionLike
): Promise<WebRTCPathStats | undefined> {
    if (!connection.getStats) return undefined;
    const report = await connection.getStats();
    const stats = [...report.values()];
    const transport = stats.find((entry) => entry.type === "transport");
    // Firefox has no transport stats; it marks the pair itself.
    const pair = transport?.selectedCandidatePairId
        ? report.get(transport.selectedCandidatePairId)
        : stats.find(
              (entry) => entry.type === "candidate-pair" && entry.selected
          );
    const describe = (id?: string) => {
        const candidate = id ? report.get(id) : undefined;
        return candidate
            ? `${candidate.candidateType} ${candidate.protocol}`
            : undefined;
    };
    const msSince = (timestamp?: number) =>
        pair && timestamp !== undefined
            ? Math.round(pair.timestamp - timestamp)
            : undefined;
    return {
        dtlsState: transport?.dtlsState,
        selectedPairChanges: transport?.selectedCandidatePairChanges,
        pairState: pair?.state,
        localCandidate: describe(pair?.localCandidateId),
        remoteCandidate: describe(pair?.remoteCandidateId),
        roundTripTimeMs:
            pair?.currentRoundTripTime === undefined
                ? undefined
                : Math.round(pair.currentRoundTripTime * 1000),
        requestsSent: pair?.requestsSent,
        responsesReceived: pair?.responsesReceived,
        requestsReceived: pair?.requestsReceived,
        responsesSent: pair?.responsesSent,
        consentRequestsSent: pair?.consentRequestsSent,
        packetsSent: pair?.packetsSent,
        packetsReceived: pair?.packetsReceived,
        msSinceLastPacketSent: msSince(pair?.lastPacketSentTimestamp),
        msSinceLastPacketReceived: msSince(pair?.lastPacketReceivedTimestamp)
    };
}

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

        // Each report waits for the previous one's stats, so reports keep the
        // order of the state changes. A connection that was closed or
        // replaced reports nothing more: its reports would reach the callbacks
        // of the peer's next connection across the worker bridge.
        const isCurrent = () =>
            this.connectionMap.get(peerAddress) === connection;
        let reported = Promise.resolve();
        const notifyState = () => {
            const state = this.getSnapshot(connection);
            reported = reported
                .then(async () => {
                    if (!isCurrent()) return;
                    // The stats are diagnostics: a failed read must not hold
                    // back the state change. A read that never settles
                    // would; no runtime is known to do that.
                    let readError: unknown;
                    const path = await readPathStats(connection).catch(
                        (error) => {
                            readError = error;
                            return undefined;
                        }
                    );
                    if (!isCurrent()) return;
                    if (readError) callbacks.onError(readError as Error);
                    callbacks.onConnectionStateChange({ ...state, path });
                })
                .catch((error) => callbacks.onError(error));
        };

        connection.addEventListener("connectionstatechange", notifyState);
        connection.addEventListener("iceconnectionstatechange", notifyState);

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
