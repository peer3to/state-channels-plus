import type { WebRTCPeerConnectionLike } from "./WebRTCConnectionTypes";

export type WebRTCProvider = {
    RTCPeerConnection: new (...args: any[]) => WebRTCPeerConnectionLike;
    RTCIceCandidate?: new (...args: any[]) => any;
};

function getGlobalWebRTCProvider(): WebRTCProvider | undefined {
    const runtime = globalThis as any;
    if (typeof runtime.RTCPeerConnection !== "function") return undefined;
    return {
        RTCPeerConnection: runtime.RTCPeerConnection,
        RTCIceCandidate: runtime.RTCIceCandidate
    };
}

export function isWorkerRuntime(): boolean {
    return (
        typeof (globalThis as any).WorkerGlobalScope !== "undefined" &&
        globalThis instanceof (globalThis as any).WorkerGlobalScope
    );
}

export function hasLocalRTCPeerConnection(): boolean {
    return !!getGlobalWebRTCProvider();
}

/**
 * True when this runtime is a worker that cannot negotiate WebRTC itself and so
 * must drive an `RTCPeerConnection` on the real main thread over a bridge port.
 * Mirrors the decision {@link createWebRTCConnectionFactory} makes — it probes
 * the lazy `get-webrtc` import too, so a worker that CAN load WebRTC locally
 * (e.g. Node with `get-webrtc`) reports `false` and no bridge is surfaced.
 */
export async function doesWorkerNeedMainThreadBridge(): Promise<boolean> {
    if (!isWorkerRuntime()) return false;
    try {
        await loadWebRTCProvider();
        return false;
    } catch {
        return true;
    }
}

export async function loadWebRTCProvider(): Promise<WebRTCProvider> {
    const globalProvider = getGlobalWebRTCProvider();
    if (globalProvider) return globalProvider;

    try {
        // @ts-expect-error - get-webrtc does not ship TypeScript declarations.
        const imported = await import("get-webrtc");
        const provider = (imported.default ??
            imported) as Partial<WebRTCProvider>;
        if (typeof provider.RTCPeerConnection === "function") {
            return {
                RTCPeerConnection:
                    provider.RTCPeerConnection as WebRTCProvider["RTCPeerConnection"],
                RTCIceCandidate: provider.RTCIceCandidate
            };
        }
    } catch (error) {
        throw error;
    }

    throw new Error("RTCPeerConnection is unavailable in this runtime");
}
