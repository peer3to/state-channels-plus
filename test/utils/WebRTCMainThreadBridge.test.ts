import { expect } from "chai";

import { installWebRTCMainThreadBridge } from "@/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory";
import { waitFor } from "./waitFor";

class FakeDataChannel {
    onmessage: ((event: { data: any }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: any) => void) | null = null;
    readyState = "open";
    readonly sent: any[] = [];

    constructor(public readonly label: string) {}

    send(data: any): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = "closed";
        this.onclose?.();
    }
}

// Minimal RTCPeerConnection stand-in so the broker can run without a real
// WebRTC stack. The broker reads it off `globalThis.RTCPeerConnection`.
class FakeRTCPeerConnection {
    connectionState = "new";
    iceConnectionState = "new";
    onconnectionstatechange: (() => void) | null = null;
    oniceconnectionstatechange: (() => void) | null = null;
    onicecandidate: ((event: { candidate?: any }) => void) | null = null;
    ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null =
        null;
    lastChannel?: FakeDataChannel;

    constructor() {
        createdConnections.push(this);
    }

    createDataChannel(label: string): FakeDataChannel {
        this.lastChannel = new FakeDataChannel(label);
        return this.lastChannel;
    }

    async createOffer() {
        return { type: "offer", sdp: "fake-offer" };
    }

    async createAnswer() {
        return { type: "answer", sdp: "fake-answer" };
    }

    async setLocalDescription() {}
    async setRemoteDescription() {}
    async addIceCandidate() {}
    close(): void {}
}

let createdConnections: FakeRTCPeerConnection[] = [];

describe("installWebRTCMainThreadBridge (provided port)", function () {
    let originalRTCPeerConnection: unknown;

    beforeEach(function () {
        originalRTCPeerConnection = (globalThis as any).RTCPeerConnection;
        (globalThis as any).RTCPeerConnection = FakeRTCPeerConnection;
        createdConnections = [];
    });

    afterEach(function () {
        (globalThis as any).RTCPeerConnection = originalRTCPeerConnection;
    });

    // The card's core acceptance: a worker drives WebRTC over a port the SDK
    // surfaced (P2pInstance.webRTCBridgePort), and the main thread binds that
    // exact port to the bridge — no "bridge port is not registered" error.
    it("binds a broker to the provided port and completes a createOffer over it", async function () {
        const channel = new MessageChannel();
        const factory = WorkerBridgeWebRTCConnectionFactory.getInstance();
        factory.registerPort(channel.port1); // worker end (registered internally)
        const handle = installWebRTCMainThreadBridge(channel.port2, {
            channelMode: "proxy"
        }); // main-thread end (the externally-provided port)

        try {
            let workerChannel: WebRTCDataChannelLike | undefined;
            const offer = await factory.createOffer("0xpeerA", {
                onIceCandidate: () => undefined,
                onDataChannel: (created) => {
                    workerChannel = created;
                },
                onConnectionStateChange: () => undefined,
                onError: (error) => {
                    throw error;
                }
            });

            expect(offer).to.deep.equal({ type: "offer", sdp: "fake-offer" });
            expect(workerChannel).to.not.equal(undefined);
            expect(workerChannel?.readyState).to.equal("open");
            expect(createdConnections).to.have.length(1);
        } finally {
            handle.dispose();
        }
    });

    // Establish a proxy-mode bridge over a provided port and return the
    // worker-side data channel, the broker-side (fake) channel, and the handle.
    async function connectProxyBridge(peerAddress: string) {
        const channel = new MessageChannel();
        const factory = WorkerBridgeWebRTCConnectionFactory.getInstance();
        factory.registerPort(channel.port1);
        const handle = installWebRTCMainThreadBridge(channel.port2, {
            channelMode: "proxy"
        });

        let workerChannel: WebRTCDataChannelLike | undefined;
        await factory.createOffer(peerAddress, {
            onIceCandidate: () => undefined,
            onDataChannel: (created) => {
                workerChannel = created;
            },
            onConnectionStateChange: () => undefined,
            onError: (error) => {
                throw error;
            }
        });

        const brokerChannel =
            createdConnections[createdConnections.length - 1].lastChannel!;
        return { workerChannel: workerChannel!, brokerChannel, handle };
    }

    it("relays an outbound data-channel send from worker to broker", async function () {
        const { workerChannel, brokerChannel, handle } =
            await connectProxyBridge("0xpeerB");
        try {
            workerChannel.send("ping");
            await waitFor(() => brokerChannel.sent.includes("ping"));
            expect(brokerChannel.sent).to.include("ping");
        } finally {
            handle.dispose();
        }
    });

    it("relays an inbound data-channel message from broker to worker", async function () {
        const { workerChannel, brokerChannel, handle } =
            await connectProxyBridge("0xpeerC");
        try {
            const inbound = new Promise<any>((resolve) => {
                workerChannel.onmessage = (event) => resolve(event.data);
            });
            brokerChannel.onmessage?.({ data: "pong" });
            expect(await inbound).to.equal("pong");
        } finally {
            handle.dispose();
        }
    });
});
