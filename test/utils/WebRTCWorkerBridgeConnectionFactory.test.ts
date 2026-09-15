import { assertAbnormalBridgeError } from "@test/fixtures/node/WebRTCBridgeFixture";
import {
    withWebRTCBridge,
    assertDelayedBridgeAttachment
} from "@test/fixtures/node/WebRTCBridgeFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("WorkerBridgeWebRTCConnectionFactory", function () {
    it("becomes ready before broker attachment and resumes queued negotiation after attachment", async () => {
        await assertDelayedBridgeAttachment(true);
    });
    it("disposes an unattached broker connection and rejects queued negotiation", async () => {
        await assertDelayedBridgeAttachment(false);
    });
    it("keeps another bridge usable when the first bridge is disposed", async function () {
        await withWebRTCBridge(async (bridge) => {
            const additional = await bridge.addOwner();
            try {
                await bridge.dispose();
                await bridge.dispose();
                const offer = await additional.factory.createOffer(
                    bridge.peerAddress,
                    bridge.callbacks
                );
                expect(offer.type).to.equal("offer");
                expect(bridge.client.connections.size).to.equal(0);
            } finally {
                await additional.dispose();
            }
        });
    });
    it("accepts a real remote offer and exchanges channel data", async function () {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate(true);
            connected.channel.send("answerer data");
            await waitFor(() => connected.received.length === 1);
            expect(connected.received).to.deep.equal(["answerer data"]);
        });
    });
    it("keeps missing-peer answer ICE and close operations as no-ops", async function () {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate();
            const missing = ethers.Wallet.createRandom().address;
            await bridge.factory.applyAnswer(missing, connected.answer);
            expect(connected.candidates.length).to.be.greaterThan(0);
            await bridge.factory.addIceCandidate(
                missing,
                connected.candidates[0]
            );
            await bridge.factory.close(missing);
            expect(bridge.factory.getState(missing).connectionState).to.equal(
                "unknown"
            );
            connected.channel.send("unrelated peer still open");
            await waitFor(() => connected.received.length === 1);
            expect(connected.received).to.deep.equal([
                "unrelated peer still open"
            ]);
        });
    });
    it("recovers negotiation after a synchronous post failure", async function () {
        await withWebRTCBridge(async (bridge) => {
            bridge.control.failNextPost("createOffer");
            const failure = await bridge.factory
                .createOffer(bridge.peerAddress, bridge.callbacks)
                .catch((error: Error) => error);
            expect(failure).to.be.instanceOf(Error);
            expect(bridge.client.router.pendingRequestCount).to.equal(0);
            expect((await bridge.negotiate()).channel.readyState).to.equal(
                "open"
            );
        });
    });
    it("ignores a late negotiation response after an explicit timeout", async function () {
        await withWebRTCBridge(async (bridge) => {
            const received = bridge.control.holdNextResponse("createOffer");
            const result = bridge.brokerRemoteRoot.rpc.negotiation
                .createOffer(bridge.peerAddress)
                .request({ timeoutMs: 1000 })
                .catch((error: Error) => error.message);
            await received;
            expect(await result).to.equal(
                "RPC request 'negotiation.createOffer' timed out after 1000ms"
            );
            bridge.control.release();
            expect(bridge.client.router.pendingRequestCount).to.equal(0);
            await bridge.factory.close(bridge.peerAddress);
            expect((await bridge.negotiate()).channel.readyState).to.equal(
                "open"
            );
        });
    });
    it("creates a proxy data channel from bridge channel events", async function () {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate();
            expect(connected.channel.readyState).to.equal("open");
            connected.channel.send("hello");
            await waitFor(() => connected.received.length === 1);
            expect(connected.received).to.deep.equal(["hello"]);
        });
    });
    it("routes bridge state and ICE events to connection callbacks", async function () {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate();
            expect(connected.states).to.include("connected");
            expect(connected.candidates.length).to.be.greaterThan(0);
            expect(
                bridge.factory.getState(bridge.peerAddress).connectionState
            ).to.equal("connected");
        });
    });
    it("rejects in-flight requests when the shared bridge is disposed", async function () {
        await withWebRTCBridge(async (bridge) => {
            const received = bridge.control.holdNextResponse("createOffer");
            const offer = bridge.factory
                .createOffer(bridge.peerAddress, bridge.callbacks)
                .catch((error: Error) => error);
            await received;
            // Disposing the final owner must reject the abandoned request rather
            // than leaving its awaiting WebRTC setup call pending forever.
            await bridge.dispose();
            const rejection = await offer;
            expect(rejection).to.be.instanceOf(Error);
            expect(rejection.message).to.include("disposed");
            expect(bridge.client.router.pendingRequestCount).to.equal(0);
        });
    });
});

describe("WorkerBridgeWebRTCConnectionFactory callback ownership", () => {
    it("keeps recursive bridge disposal idempotent", async () => {
        await withWebRTCBridge(async (bridge) => {
            const first = bridge.dispose();
            expect(first === bridge.dispose()).to.equal(true);
            await first;
            expect(bridge.client.connections.size).to.equal(0);
            expect(bridge.brokerRemoteRoot.isClosed).to.equal(true);
            expect(bridge.client.router.pendingRequestCount).to.equal(0);
        });
    });
    it("delivers real connection changes only to replacement callbacks", async () => {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate();
            const originalCount = connected.states.length;
            const replacedStates: string[] = [];
            bridge.factory.setCallbacks(bridge.peerAddress, {
                ...bridge.callbacks,
                onConnectionStateChange: (state) => {
                    replacedStates.push(state.connectionState);
                }
            });
            await bridge.factory.close(bridge.peerAddress);
            await waitFor(() => replacedStates.length > 0);
            expect(connected.states.length).to.equal(originalCount);
            expect(replacedStates).to.include("closed");
        });
    });
    it("ignores retired provider channel callbacks after reconnect", async () => {
        await withWebRTCBridge(async (bridge) => {
            await bridge.negotiate();
            const emitRetired = bridge.captureCurrentChannelCallbacks();
            await bridge.factory.close(bridge.peerAddress);
            const reconnected = await bridge.negotiate();
            const before = bridge.control.events.length;
            emitRetired();
            await bridge.factory.addIceCandidate(
                ethers.Wallet.createRandom().address,
                reconnected.candidates[0]
            );
            const callbacks = bridge.control.events
                .slice(before)
                .filter(
                    (event) => event.direction === "receive" && event.method
                );
            expect(
                callbacks.some(
                    (event) =>
                        event.method === "proxyMessage" ||
                        event.method === "proxyState"
                )
            ).to.equal(false);
            reconnected.channel.send("reconnected channel data");
            await waitFor(() =>
                reconnected.received.includes("reconnected channel data")
            );
        });
    });
    it("sends only one proxy close while closing and after closure", async () => {
        await withWebRTCBridge(async (bridge) => {
            const connected = await bridge.negotiate();
            const before = bridge.control.sent.filter(
                (frame) => frame.method === "proxyClose"
            ).length;
            connected.channel.close();
            connected.channel.close();
            await waitFor(() => connected.channel.readyState === "closed");
            connected.channel.close();
            expect(
                bridge.control.sent.filter(
                    (frame) => frame.method === "proxyClose"
                ).length - before
            ).to.equal(1);
        });
    });
});

describe("WebRTC bridge error boundary", () => {
    it("delivers broker errors and an abnormal bridge closure to the owner", async () => {
        await assertAbnormalBridgeError();
    });
});
