import { expect } from "chai";

import WebRTCTransport from "@/transport/WebRTCTransport";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory";

class FakeRTCDataChannel implements WebRTCDataChannelLike {
    label = "webRTC-DataChannel";
    readyState = "open";
    onmessage: ((event: { data: any }) => void) | null = null;
    onopen: ((event?: any) => void) | null = null;
    onclose: ((event?: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    readonly sent: string[] = [];

    send(data: any): void {
        if (this.readyState !== "open") {
            throw new Error("RTCDataChannel.readyState is not 'open'");
        }
        this.sent.push(data);
    }

    close(): void {
        this.readyState = "closed";
        this.onclose?.();
    }

    emitMessage(data: any): void {
        this.onmessage?.({ data });
    }

    emitOpen(): void {
        this.onopen?.();
    }
}

function createP2PManager(
    options: {
        onRpc?: (serializedRPC: string, transport: any) => void;
        onInitHandshake?: (transport: any) => void;
    } = {}
) {
    const logger = {
        child: () => logger,
        debug: () => undefined,
        verbose: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        info: () => undefined
    };
    const manager = {
        logger,
        stateManager: {
            logger,
            p2pEventHooks: {},
            getChannelId: () => "0xchannel",
            forkId: "0xfork"
        },
        localRpc: {
            initHandshakeService: {
                initHandshake: options.onInitHandshake || (() => undefined)
            },
            webRTCSetupService: {
                closeWebRTCConnection: () => undefined
            }
        },
        profileManager: {
            getProfileByTransport: () => undefined
        },
        disconnectConnection: () => undefined,
        onRpc: options.onRpc || (() => undefined)
    };
    return manager as any;
}

describe("WebRTCTransport", function () {
    it("queues outbound RPCs while connecting until the channel opens", function () {
        const channel = new FakeRTCDataChannel();
        channel.readyState = "connecting";
        let handshakes = 0;

        const transport = new WebRTCTransport(
            channel,
            createP2PManager({
                onInitHandshake: () => {
                    handshakes++;
                }
            })
        );

        transport._send("queued");

        expect(handshakes).to.equal(0);
        expect(channel.sent).to.deep.equal([]);

        channel.readyState = "open";
        channel.emitOpen();

        expect(handshakes).to.equal(1);
        expect(channel.sent).to.deep.equal(["queued"]);
    });

    it("starts the WebRTC handshake when constructed with an open channel", function () {
        const channel = new FakeRTCDataChannel();
        let handshakes = 0;
        const transport = new WebRTCTransport(
            channel,
            createP2PManager({
                onInitHandshake: () => {
                    handshakes++;
                }
            })
        );

        expect(handshakes).to.equal(1);
        expect(transport.webRTCChannel.readyState).to.equal("open");
    });

    it("sends over the open data channel", function () {
        const channel = new FakeRTCDataChannel();
        const transport = new WebRTCTransport(channel, createP2PManager());

        transport._send("outbound");

        expect(channel.sent).to.deep.equal(["outbound"]);
    });

    it("drops outbound RPCs after the channel closes", function () {
        const channel = new FakeRTCDataChannel();
        const transport = new WebRTCTransport(channel, createP2PManager());

        channel.close();
        transport._send("dropped");

        expect(channel.sent).to.deep.equal([]);
    });
});
