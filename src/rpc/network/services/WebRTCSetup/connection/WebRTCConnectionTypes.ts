import type { Address } from "@/types";

export type WebRTCPeerAddress = Address;

/**
 * The connection's selected network path, read from `getStats()` when its
 * state changed. A field the runtime does not report is absent.
 */
export type WebRTCPathStats = {
    dtlsState?: string;
    selectedPairChanges?: number;
    pairState?: string;
    /** Candidate type and protocol, e.g. "host udp". */
    localCandidate?: string;
    remoteCandidate?: string;
    roundTripTimeMs?: number;
    /** Connectivity checks sent and answered, both directions. */
    requestsSent?: number;
    responsesReceived?: number;
    requestsReceived?: number;
    responsesSent?: number;
    consentRequestsSent?: number;
    packetsSent?: number;
    packetsReceived?: number;
    msSinceLastPacketSent?: number;
    msSinceLastPacketReceived?: number;
};

export type WebRTCConnectionStateSnapshot = {
    connectionState: string;
    iceState: string;
    /** Absent when the runtime has no `getStats()` or the read failed. */
    path?: WebRTCPathStats;
};

export type WebRTCDataChannelLike = {
    label?: string;
    readyState?: string;
    onmessage?: ((event: { data: any }) => void) | null;
    onopen?: ((event?: any) => void) | null;
    onclose?: ((event?: any) => void) | null;
    onerror?: ((event: any) => void) | null;
    send(data: any): void;
    close(): void;
};

export type WebRTCPeerConnectionLike = {
    connectionState?: string;
    iceConnectionState?: string;
    /** werift fires the ICE state change only as an event, never through `oniceconnectionstatechange`. */
    addEventListener(
        type: "connectionstatechange" | "iceconnectionstatechange",
        listener: () => void
    ): void;
    onicecandidate?: ((event: { candidate?: any }) => void) | null;
    ondatachannel?:
        | ((event: { channel: WebRTCDataChannelLike }) => void)
        | null;
    createDataChannel(label: string): WebRTCDataChannelLike;
    createOffer(): Promise<any>;
    createAnswer(): Promise<any>;
    setLocalDescription(description: any): Promise<void>;
    setRemoteDescription(description: any): Promise<void>;
    addIceCandidate(candidate: any): Promise<void>;
    /** Browsers only; the Node implementation (werift) has none. */
    getStats?(): Promise<WebRTCStatsReport>;
    close(): void;
};

/** The parts of an `RTCStatsReport` the path stats read. */
export type WebRTCStatsReport = {
    get(id: string): Record<string, any> | undefined;
    values(): IterableIterator<Record<string, any>>;
};

export type WebRTCConnectionCallbacks = {
    onIceCandidate(candidate: any): void;
    onDataChannel(channel: WebRTCDataChannelLike): void;
    onConnectionStateChange(state: WebRTCConnectionStateSnapshot): void;
    onError(error: Error): void;
};

export interface WebRTCConnectionFactory {
    createOffer(
        peerAddress: WebRTCPeerAddress,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any>;
    acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any,
        callbacks: WebRTCConnectionCallbacks
    ): Promise<any>;
    applyAnswer(peerAddress: WebRTCPeerAddress, answer: any): Promise<void>;
    addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void>;
    close(peerAddress: WebRTCPeerAddress): Promise<void>;
    getState(peerAddress: WebRTCPeerAddress): WebRTCConnectionStateSnapshot;
}

export const UNKNOWN_STATE: WebRTCConnectionStateSnapshot = {
    connectionState: "unknown",
    iceState: "unknown"
};
