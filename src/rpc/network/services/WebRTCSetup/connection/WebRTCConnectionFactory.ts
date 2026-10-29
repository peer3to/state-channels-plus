import LocalWebRTCConnectionFactory from "./LocalWebRTCConnectionFactory";
import type { WebRTCConnectionFactory } from "./WebRTCConnectionTypes";
import { loadWebRTCProvider } from "./WebRTCProvider";

export async function createWebRTCConnectionFactory(): Promise<WebRTCConnectionFactory> {
    try {
        const provider = await loadWebRTCProvider();
        return new LocalWebRTCConnectionFactory(provider);
    } catch {
        throw new Error(
            "RTCPeerConnection is unavailable in this runtime and no WebRTC main-thread bridge is installed."
        );
    }
}

export type {
    WebRTCConnectionCallbacks,
    WebRTCConnectionFactory,
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress,
    WebRTCPeerConnectionLike
} from "./WebRTCConnectionTypes";
