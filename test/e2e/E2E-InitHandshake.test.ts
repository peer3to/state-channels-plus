import { TransportType } from "@/transport/TransportType";
import { TestSession, PeerTestHarness, sleep } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

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
            const transportToPeer1Before = h.query.getTransport(0, 1); // ensure transport exists
            if (!transportToPeer1Before) {
                throw new Error(
                    "Expected transport from peer 0 to peer 1 to exist after handshake completion"
                );
            }
            const peer1Profile = h.query.getProfile(0, {
                transport: transportToPeer1Before
            });
            if (!peer1Profile) {
                throw new Error(
                    "Expected to find profile for peer 1 in peer 0's profile manager using the transport after handshake completion"
                );
            }
            if (peer1Profile.transport != transportToPeer1Before) {
                throw new Error(
                    "Expected profile transport to match the transport used for handshake completion"
                );
            }

            if (
                peer1Profile.transport.transportType !== TransportType.HOLEPUNCH
            ) {
                throw new Error(
                    `Expected initial handshake to be completed using HOLEPUNCH transport, but was ${TransportType[peer1Profile.transport.transportType]}`
                );
            }
            const peer0LocalRpc = h.rpc.getLocalRpc(0);
            h.event.resetEventSpies();
            await peer0LocalRpc.webRTCSetupService.initiateWebRTC(
                transportToPeer1Before
            );

            await h.event.waitUntilEventOccurs("onConnection", 10000);
            if (
                peer1Profile.transport.transportType === TransportType.HOLEPUNCH
            ) {
                const refreshedPeer1Profile = h.query.getProfile(0, {
                    evmAddress: h.getPeer(1).address
                });
                const isSameProfile = refreshedPeer1Profile === peer1Profile;
                const transportType =
                    TransportType[
                        refreshedPeer1Profile!.transport!.transportType
                    ];
                throw new Error(
                    `Transport didn't upgrade to WebRTC - still HOLEPUNCH, profile same: ${isSameProfile}, transport type: ${transportType}`
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
                autoConnect: false,
                timeConfig: { agreementTime: 1 }
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
