import {
    ScenarioRunner,
    Scenario,
    AssertRPC,
    Event,
    RPC,
    PeerTestHarness,
    Time
} from "@test/harness";

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
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 0, { autoConnect: false }),

                RPC.connectPeers([0, 1]),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.newPeerJoins({
                    newPeerIndex: 2,
                    observingPeerIndex: 0
                }),

                AssertRPC.allHandshakesCompleted([
                    { peer1: 0, peer2: 1 },
                    { peer1: 0, peer2: 2 }
                ])
            );
        });

        it("should update existing profile transport on successful handshake", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(2, 0, { autoConnect: true }),
                Event.waitUntilEventOccurs("onConnection", 5000),

                AssertRPC.handshakeCompleted({ peer1: 0, peer2: 1 }),

                // Clear and re-initiate handshake
                RPC.clearHandshakeChallenge({
                    peerIndex: 0,
                    targetPeer: 1
                }),

                RPC.initiateHandshake({
                    fromPeer: 0,
                    toPeer: 1
                }),

                // Send valid response to complete handshake again
                RPC.sendValidHandshakeResponse({
                    fromPeer: 1,
                    toPeer: 0
                }),

                // Handshake should still be completed, profile updated
                AssertRPC.handshakeCompleted({ peer1: 0, peer2: 1 })
            );
        });
    });

    describe("Time Validation", function () {
        it("should disconnect peer when handshake request time difference exceeds agreementTime", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 0, { autoConnect: false }),

                RPC.connectPeers([0, 1]),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.newPeerJoins({
                    newPeerIndex: 2,
                    observingPeerIndex: 1
                }),

                RPC.sendInvalidTimeHandshakeRequest({
                    fromPeer: 2,
                    toPeer: 1,
                    timeOffset: 2000
                }),

                // Peer 1 should disconnect peer 2, leaving only connection to peer 0
                AssertRPC.peerDisconnectedFrom({
                    peerIndex: 1,
                    expectedFinalCount: 1
                })
            );
        });

        it("should disconnect peer that doesn't respond within agreementTime", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 0, {
                    autoConnect: false,
                    timeConfig: { agreementTime: 1 }
                }),

                RPC.connectPeers([0, 1]),
                Event.waitUntilEventOccurs("onConnection", 5000),

                // Initiate handshake without response (timeout test)
                RPC.initiateHandshakeWithoutResponse({
                    fromPeer: 0,
                    toPeer: 1
                }),

                // Wait for agreementTime (1s) + buffer for timeout to trigger
                Time.wait(1500),

                // Verify transport is closed by timeout mechanism
                AssertRPC.transportClosedOrGone({
                    fromPeer: 0,
                    toPeer: 1
                })
            );
        });

        it("should disconnect peer when handshake response RTT exceeds agreementTime", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 0, { autoConnect: false }),

                RPC.connectPeers([0, 1]),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.newPeerJoins({
                    newPeerIndex: 2,
                    observingPeerIndex: 0
                }),

                RPC.initiateHandshake({
                    fromPeer: 0,
                    toPeer: 2
                }),

                RPC.sendSlowHandshakeResponse({
                    fromPeer: 2,
                    toPeer: 0,
                    delaySeconds: 100
                }),

                // Peer 0 should disconnect peer 2, leaving only connection to peer 1
                AssertRPC.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 1
                })
            );
        });

        it("should disconnect peer when handshake response time doesn't match init time", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(2, 0, { autoConnect: true }),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.clearHandshakeChallenge({
                    peerIndex: 0,
                    targetPeer: 1
                }),

                RPC.initiateHandshake({
                    fromPeer: 0,
                    toPeer: 1
                }),

                RPC.sendSlowHandshakeResponse({
                    fromPeer: 1,
                    toPeer: 0,
                    delaySeconds: 10
                }),

                // Peer 0 should disconnect peer 1, leaving 0 connections (only 2 peers)
                AssertRPC.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 0
                })
            );
        });
    });

    describe("Signature Validation", function () {
        it("should disconnect peer when handshake response has invalid signature", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(2, 0, { autoConnect: true }),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.clearHandshakeChallenge({
                    peerIndex: 0,
                    targetPeer: 1
                }),

                RPC.initiateHandshake({
                    fromPeer: 0,
                    toPeer: 1
                }),

                RPC.sendInvalidSignatureHandshakeResponse({
                    fromPeer: 1,
                    toPeer: 0
                }),

                AssertRPC.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 0
                })
            );
        });
    });

    describe("Unsolicited Messages", function () {
        it("should disconnect peer sending unsolicited handshake response", async function () {
            await ScenarioRunner.execute(
                Scenario.startChannel(3, 0, { autoConnect: false }),

                RPC.connectPeers([0, 1]),
                Event.waitUntilEventOccurs("onConnection", 5000),

                RPC.newPeerJoins({
                    newPeerIndex: 2,
                    observingPeerIndex: 0
                }),

                RPC.sendUnsolicitedHandshakeResponse({
                    fromPeer: 2,
                    toPeer: 0
                }),

                // Peer 0 should disconnect peer 2, leaving only connection to peer 1
                AssertRPC.peerDisconnectedFrom({
                    peerIndex: 0,
                    expectedFinalCount: 1
                })
            );
        });
    });
});
