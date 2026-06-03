import { TransportType } from "@/transport/TransportType";
import { MathTestSession as TestSession, sleep } from "@test/harness";

/**
 * E2E Tests for Handshake Initialization
 *
 * Maps to: src/rpc/services/initHandshake/InitHandshakeService.ts
 *          src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts
 *          src/ProfileManager.ts
 *
 * Tests the handshake protocol, peer profile creation, and time validation.
 */
describe("E2E: Init Handshake", function () {
    describe("Handshake Completion", function () {
        it("should complete handshake successfully and create peer profile", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { autoConnect: false });
            await h.rpc.connectPeers([0, 1]);
            await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
            await h.rpc.newPeerJoins({
                newPeerIndex: 2,
                observingPeerIndex: 0
            });
            await h.assert.rpc.allHandshakesCompleted([
                { peer1: 0, peer2: 1 },
                { peer1: 0, peer2: 2 }
            ]);
        });

        it("should update existing profile transport on WebRTC upgrade", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0, { autoConnect: true });
            await h.event.waitUntilEventOccurs("onConnection", 5000);
            h.assert.rpc.handshakeCompleted({ peer1: 0, peer2: 1 });

            const peer1Addr = h.getPeerHandle(1).address;
            const peer0Handle = h.getPeerHandle(0);

            const statusBefore =
                await peer0Handle.queryInternals.getTransportStatus(peer1Addr);
            if (!statusBefore.present) {
                throw new Error(
                    "Expected transport from peer 0 to peer 1 to exist after handshake completion"
                );
            }

            const typeBefore =
                await peer0Handle.queryInternals.getPreferredTransportType();
            if (typeBefore !== TransportType.HOLEPUNCH) {
                throw new Error(
                    `Expected initial handshake to be completed using HOLEPUNCH transport, but was ${TransportType[typeBefore]}`
                );
            }

            // White-box: initiateWebRTC requires the live transport object.
            const peer0 = h.getPeer(0);
            const transport =
                peer0.stateManager.p2pManager.openConnections.find(
                    (t) =>
                        peer0.stateManager.p2pManager.profileManager.getProfileByTransport(
                            t
                        )?.evmAddress === peer1Addr
                );
            if (!transport)
                throw new Error("Transport not found for initiateWebRTC");

            const peer0LocalRpc = h.rpc.getLocalRpc(0);
            h.event.resetEventSpies();
            await peer0LocalRpc.webRTCSetupService.initiateWebRTC(transport);

            await h.event.waitUntilEventOccurs("onConnection", 10000);

            const typeAfter =
                await peer0Handle.queryInternals.getPreferredTransportType();
            if (typeAfter === TransportType.HOLEPUNCH) {
                throw new Error(
                    `Transport didn't upgrade to WebRTC - still HOLEPUNCH`
                );
            }
        });
    });

    describe("Time Validation", function () {
        it("should disconnect peer when handshake request time difference exceeds agreementTime", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { autoConnect: false });
            await h.rpc.connectPeers([0, 1]);
            await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
            await h.rpc.newPeerJoins({
                newPeerIndex: 2,
                observingPeerIndex: 1
            });
            await h.rpc.sendInvalidTimeHandshakeRequest({
                fromPeer: 2,
                toPeer: 1,
                timeOffset: 2000
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 1,
                expectedFinalCount: 1
            });
        });

        it("should disconnect peer that doesn't respond within agreementTime", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                autoConnect: false
            });
            await h.rpc.connectPeers([0, 1]);
            await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
            await h.rpc.initiateHandshakeWithoutResponse({
                fromPeer: 0,
                toPeer: 1
            });
            await sleep(1500);
            await h.assert.rpc.transportClosedOrGone({
                fromPeer: 0,
                toPeer: 1
            });
        });

        it("should disconnect peer when handshake response RTT exceeds agreementTime", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { autoConnect: false });
            await h.rpc.connectPeers([0, 1]);
            await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
            await h.rpc.newPeerJoins({
                newPeerIndex: 2,
                observingPeerIndex: 0
            });
            await h.rpc.initiateHandshake({ fromPeer: 0, toPeer: 2 });
            await h.rpc.sendSlowHandshakeResponse({
                fromPeer: 2,
                toPeer: 0,
                delaySeconds: 100
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 1
            });
        });

        it("should disconnect peer when handshake response time doesn't match init time", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0, { autoConnect: true });
            await h.event.waitUntilEventOccurs("onConnection", 5000);
            await h.rpc.clearHandshakeChallenge({
                peerIndex: 0,
                targetPeer: 1
            });
            await h.rpc.initiateHandshake({ fromPeer: 0, toPeer: 1 });
            await h.rpc.sendSlowHandshakeResponse({
                fromPeer: 1,
                toPeer: 0,
                delaySeconds: 10
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 0
            });
        });
    });

    describe("Unsolicited Messages", function () {
        it("should disconnect peer sending unsolicited handshake response", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { autoConnect: false });
            await h.rpc.connectPeers([0, 1]);
            await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
            await h.rpc.newPeerJoins({
                newPeerIndex: 2,
                observingPeerIndex: 0
            });
            await h.rpc.sendUnsolicitedHandshakeResponse({
                fromPeer: 2,
                toPeer: 0
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 1
            });
        });
    });
});
