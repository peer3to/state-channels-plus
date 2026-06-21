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

function isWorkerRuntime(): boolean {
    return (
        typeof (globalThis as any).WorkerGlobalScope !== "undefined" &&
        globalThis instanceof (globalThis as any).WorkerGlobalScope
    );
}

export function hasLocalRTCPeerConnection(): boolean {
    return !!getGlobalWebRTCProvider();
}

export function isRTCPeerConnectionUnavailableWorker(): boolean {
    return isWorkerRuntime() && !hasLocalRTCPeerConnection();
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
