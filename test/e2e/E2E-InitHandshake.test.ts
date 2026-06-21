import { expect } from "chai";
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

            const peer0 = h.getPeer(0);
            const peer1Address = h.getPeer(1).address;

            // The upgrade flow runs host-side, where the live transport/profile
            // are. Assert peer 0's profile for peer 1 uses HOLEPUNCH, tag the
            // profile so we can prove it's updated in place (not replaced), then
            // trigger the WebRTC upgrade over its transport.
            h.event.resetEventSpies();
            const before = await h.execOnHost(
                peer0,
                (sm, args) => {
                    const profile =
                        sm.p2pManager.profileManager.getProfileByEvmAddress(
                            args.peer1Address
                        );
                    if (!profile?.transport) {
                        throw new Error(
                            "no profile/transport for peer 1 after handshake"
                        );
                    }
                    const transportType = profile.transport.transportType;
                    (profile as { upgradeTag?: number }).upgradeTag = 1;
                    void sm.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                        profile.transport
                    );
                    return { transportType };
                },
                { peer1Address }
            );
            expect(before.transportType).to.equal(
                TransportType.HOLEPUNCH,
                "initial handshake should complete over HOLEPUNCH"
            );

            await h.event.waitUntilEventOccurs("onConnection", 10000);

            // The same profile object must now point at a WEBRTC transport.
            const after = await h.execOnHost(
                peer0,
                (sm, args) => {
                    const profile =
                        sm.p2pManager.profileManager.getProfileByEvmAddress(
                            args.peer1Address
                        );
                    if (!profile?.transport) {
                        throw new Error(
                            "no profile/transport for peer 1 after upgrade"
                        );
                    }
                    return {
                        transportType: profile.transport.transportType,
                        sameProfile:
                            (profile as { upgradeTag?: number }).upgradeTag ===
                            1
                    };
                },
                { peer1Address }
            );
            expect(
                after.sameProfile,
                "existing profile should be updated in place"
            ).to.equal(true);
            expect(
                after.transportType,
                "transport should upgrade to WEBRTC"
            ).to.equal(TransportType.WEBRTC);
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
