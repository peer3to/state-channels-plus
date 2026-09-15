import { assertWebRTCTransportDelivery } from "../fixtures/NetworkRpcRouterFixture";

describe("WebRTCTransport", function () {
    it("queues sends on a connecting channel and flushes them once it opens", async function () {
        await assertWebRTCTransportDelivery("queue");
    });
    it("starts the WebRTC handshake when constructed with an open channel", async function () {
        await assertWebRTCTransportDelivery("open");
    });
    it("starts the handshake only once even if the open event fires again", async function () {
        await assertWebRTCTransportDelivery("repeat");
    });
    it("sends over the open data channel", async function () {
        await assertWebRTCTransportDelivery("send");
    });
    it("drops sends when the channel is already closed", async function () {
        await assertWebRTCTransportDelivery("closed");
    });
});
