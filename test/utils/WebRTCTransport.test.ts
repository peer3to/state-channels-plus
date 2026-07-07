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
    it("queues sends on a connecting channel and flushes them once it opens", function () {
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

        // A non-open channel must not send, handshake, or throw on construction.
        expect(handshakes).to.equal(0);

        transport._send("queued-1");
        transport._send("queued-2");
        expect(channel.sent).to.deep.equal([]);

        // Once the channel opens, queued RPCs flush in order and the handshake starts.
        channel.readyState = "open";
        channel.onopen?.();

        expect(channel.sent).to.deep.equal(["queued-1", "queued-2"]);
        expect(handshakes).to.equal(1);
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

    it("starts the handshake only once even if the open event fires again", function () {
        const channel = new FakeRTCDataChannel();
        let handshakes = 0;
        new WebRTCTransport(
            channel,
            createP2PManager({
                onInitHandshake: () => {
                    handshakes++;
                }
            })
        );

        // Constructed open (handshake #1); a redundant open event must not re-handshake.
        channel.onopen?.();

        expect(handshakes).to.equal(1);
    });

    it("sends over the open data channel", function () {
        const channel = new FakeRTCDataChannel();
        const transport = new WebRTCTransport(channel, createP2PManager());

        transport._send("outbound");

        expect(channel.sent).to.deep.equal(["outbound"]);
    });

    it("drops sends when the channel is already closed", function () {
        const channel = new FakeRTCDataChannel();
        channel.readyState = "closed";
        const transport = new WebRTCTransport(channel, createP2PManager());

        transport._send("dropped");

        expect(channel.sent).to.deep.equal([]);
    });
});
