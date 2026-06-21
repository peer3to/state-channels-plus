import type { Address } from "@/types";

export type WebRTCPeerAddress = Address;

export type WebRTCConnectionStateSnapshot = {
    connectionState: string;
    iceState: string;
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
    onconnectionstatechange?: ((event?: any) => void) | null;
    oniceconnectionstatechange?: ((event?: any) => void) | null;
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
    close(): void;
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
