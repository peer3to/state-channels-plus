import { expect } from "chai";

import WorkerBridgeWebRTCConnectionFactory from "@/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import {
    WEBRTC_BRIDGE_NAMESPACE,
    type WebRTCBridgePortMessage
} from "@/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory";

function nextPortMessage(port: MessagePort): Promise<WebRTCBridgePortMessage> {
    return new Promise((resolve) => {
        port.addEventListener(
            "message",
            (event: MessageEvent<WebRTCBridgePortMessage>) => {
                resolve(event.data);
            },
            { once: true }
        );
        port.start();
    });
}

describe("WorkerBridgeWebRTCConnectionFactory", function () {
    it("creates a proxy data channel from bridge channel events", async function () {
        const channel = new MessageChannel();
        const factory = WorkerBridgeWebRTCConnectionFactory.getInstance();
        factory.registerPort(channel.port1);

        let dataChannel: WebRTCDataChannelLike | undefined;
        const offerPromise = factory.createOffer("0xpeer", {
            onIceCandidate: () => undefined,
            onDataChannel: (createdChannel) => {
                dataChannel = createdChannel;
            },
            onConnectionStateChange: () => undefined,
            onError: (error) => {
                throw error;
            }
        });

        const request = await nextPortMessage(channel.port2);
        expect(request.type).to.equal("request");
        if (request.type !== "request") throw new Error("expected request");
        expect(request.request.method).to.equal("createOffer");

        channel.port2.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "channel",
            peerAddress: "0xpeer",
            mode: "proxy",
            label: "webRTC-DataChannel",
            readyState: "open"
        } satisfies WebRTCBridgePortMessage);

        channel.port2.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "response",
            requestId: request.requestId,
            ok: true,
            result: { type: "offer", sdp: "fake-offer" }
        } satisfies WebRTCBridgePortMessage);

        const offer = await offerPromise;
        expect(offer).to.deep.equal({ type: "offer", sdp: "fake-offer" });
        expect(dataChannel).to.not.equal(undefined);
        expect(dataChannel?.readyState).to.equal("open");

        dataChannel!.send("hello");
        const proxySend = await nextPortMessage(channel.port2);
        expect(proxySend).to.deep.include({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "proxySend",
            peerAddress: "0xpeer",
            data: "hello"
        });
    });

    it("routes bridge state and ICE events to connection callbacks", async function () {
        const channel = new MessageChannel();
        const factory = WorkerBridgeWebRTCConnectionFactory.getInstance();
        factory.registerPort(channel.port1);

        let iceCandidate: unknown;
        let state:
            | {
                  connectionState: string;
                  iceState: string;
              }
            | undefined;

        const answerPromise = factory.acceptOffer(
            "0xpeer",
            { type: "offer", sdp: "fake-offer" },
            {
                onIceCandidate: (candidate) => {
                    iceCandidate = candidate;
                },
                onDataChannel: () => undefined,
                onConnectionStateChange: (nextState) => {
                    state = nextState;
                },
                onError: (error) => {
                    throw error;
                }
            }
        );

        const request = await nextPortMessage(channel.port2);
        expect(request.type).to.equal("request");
        if (request.type !== "request") throw new Error("expected request");

        channel.port2.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "state",
            peerAddress: "0xpeer",
            state: {
                connectionState: "connected",
                iceState: "connected"
            }
        } satisfies WebRTCBridgePortMessage);
        channel.port2.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "iceCandidate",
            peerAddress: "0xpeer",
            candidate: { candidate: "candidate:1" }
        } satisfies WebRTCBridgePortMessage);
        channel.port2.postMessage({
            namespace: WEBRTC_BRIDGE_NAMESPACE,
            type: "response",
            requestId: request.requestId,
            ok: true,
            result: { type: "answer", sdp: "fake-answer" }
        } satisfies WebRTCBridgePortMessage);

        await answerPromise;
        expect(state).to.deep.equal({
            connectionState: "connected",
            iceState: "connected"
        });
        expect(iceCandidate).to.deep.equal({ candidate: "candidate:1" });
    });

    it("rejects in-flight requests when the bridge port is replaced", async function () {
        const first = new MessageChannel();
        const factory = WorkerBridgeWebRTCConnectionFactory.getInstance();
        factory.registerPort(first.port1);

        const offerPromise = factory.createOffer("0xpeer", {
            onIceCandidate: () => undefined,
            onDataChannel: () => undefined,
            onConnectionStateChange: () => undefined,
            onError: () => undefined
        });

        // Replacing the port must reject the abandoned request rather than
        // leaving its awaiting WebRTC setup call pending forever.
        const second = new MessageChannel();
        factory.registerPort(second.port1);

        let rejection: Error | undefined;
        try {
            await offerPromise;
        } catch (error) {
            rejection = error as Error;
        }

        expect(rejection).to.be.instanceOf(Error);
        expect(rejection?.message).to.contain("replaced");
    });
});
