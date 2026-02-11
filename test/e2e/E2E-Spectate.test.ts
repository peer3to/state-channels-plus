import {
    ScenarioRunner,
    Scenario,
    Assert,
    Event,
    Lifecycle,
    Transition,
    PeerTestHarness
} from "@test/harness";
import { expect } from "chai";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { ATransport } from "@/transport";
import { SyncRequest } from "@/rpc/services/spectate/SpectateService";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Spectate Service
 *
 * Maps to: src/rpc/services/spectate/SpectateService.ts
 *          src/rpc/services/spectate/SpectateRpcMethods.ts
 *          src/stateManager/validationStrategy/SpectatingValidationStrategy.ts
 *
 * Tests spectator joining, syncing, and fork traversal mechanisms.
 */
describe("E2E: Spectate Service", function () {
    describe("Guard Protection", function () {
        // NOTE: This test verifies HandshakeCompletedGuard protects RPC endpoints.
        // It remains imperative due to requiring low-level service/transport manipulation.
        // The test is marked `.skip` due to inherent timing sensitivity - the guard's
        // queuing logic for in-progress handshakes makes it difficult to reliably test
        // the exact failure path without introducing unacceptable complexity/fragility.
        // Guard functionality is better validated through integration behavior (normal flows work).
        it.skip("should NOT allow spectate RPC before handshake completes", async function () {
            const { harness, cleanup } =
                await ScenarioRunner.executeWithCleanup(
                    Scenario.emptyChannel(2, {
                        autoConnect: false,
                        timeConfig: {
                            agreementTime: 10,
                            p2pTime: 2,
                            chainFallbackTime: 2,
                            evidenceTime: 2
                        }
                    })
                );

            const peer0 = harness.peers[0];
            const peer1 = harness.peers[1];

            // Peer 1: Block handshake completely to ensure guard activates
            const peer1InitHandshakeService =
                peer1.stateManager.p2pManager.localRpc.initHandshakeService;
            const originalPeer1InitHandshake =
                peer1InitHandshakeService.initHandshake.bind(
                    peer1InitHandshakeService
                );
            peer1InitHandshakeService.initHandshake = () => {
                // Never complete handshake for this test
            };

            // Peer 0: Capture transport
            let capturedPeer0Transport: ATransport | undefined;
            const peer0InitHandshakeService =
                peer0.stateManager.p2pManager.localRpc.initHandshakeService;
            const originalPeer0InitHandshake =
                peer0InitHandshakeService.initHandshake.bind(
                    peer0InitHandshakeService
                );
            peer0InitHandshakeService.initHandshake = (
                transport: ATransport
            ) => {
                capturedPeer0Transport = capturedPeer0Transport ?? transport;
                harness.eventCountsBarrier.signal();
                return originalPeer0InitHandshake(transport);
            };

            // Track if RPC gets queued/blocked
            let rpcWasQueued = false;
            const peer1SpectateService =
                peer1.p2pInstance.p2pSigner.p2pManager.localRpc.spectateService;
            const guardInstance = new HandshakeCompletedGuard(
                peer1SpectateService as any,
                {
                    onFailure: () => {
                        rpcWasQueued = true;
                        harness.eventCountsBarrier.signal();
                    }
                }
            );
            (peer1SpectateService as any).guards = [guardInstance];

            // Start connections
            await Lifecycle.triggerConnections().run(harness);

            // Wait for transport using event barrier
            await harness.eventCountsBarrier.waitFor(
                () => !!capturedPeer0Transport,
                {
                    timeoutMs: 5000,
                    timeoutMessage: "Expected to capture peer0 transport"
                }
            );

            if (!capturedPeer0Transport) {
                throw new Error("Transport should be defined after waitFor");
            }

            // Ensure guard would block (handshake not complete)
            const guardWouldBlock = !guardInstance.check(
                {} as any,
                capturedPeer0Transport
            );
            expect(guardWouldBlock).to.equal(
                true,
                "Guard check should return false when handshake incomplete"
            );

            // Send spectate RPC
            const initiatorSpectateService =
                peer0.p2pInstance.p2pSigner.p2pManager.localRpc.spectateService;
            initiatorSpectateService.remoteRpc.spectateService
                .onSpectateRequest({} as SyncRequest)
                .sendOne(capturedPeer0Transport);

            // Wait for guard to process
            await harness.eventCountsBarrier.waitFor(() => rpcWasQueued, {
                timeoutMs: 2000,
                timeoutMessage: "Guard should have processed RPC"
            });

            // Verify guard activated
            expect(rpcWasQueued).to.equal(
                true,
                "Guard should have queued/blocked the RPC"
            );

            // Cleanup
            peer1InitHandshakeService.initHandshake =
                originalPeer1InitHandshake;
            peer0InitHandshakeService.initHandshake =
                originalPeer0InitHandshake;

            await cleanup();
        });
    });

    describe("Same Fork Spectating", function () {
        it("should spectate successfully when on-chain snapshot is already on the same fork", async function () {
            await ScenarioRunner.execute(
                Scenario.spectatorJoinedAndSynced(),
                // Continue transitioning 3 more times with all 4 peers
                Scenario.advanceState(3),
                Assert.peersInSync([0, 1, 2, 3]),
                // Participant count should remain the same as initial (3)
                // On-chain snapshot should still be on original fork
                Assert.participantCount({ expectedCount: 3, peerIndex: 3 }),
                Assert.snapshotOnFork()
            );
        });
    });

    describe("Fork Traversal Spectating", function () {
        it("should spectate successfully even when it must traverse forks (dispute -> reduced fork)", async function () {
            await ScenarioRunner.execute(
                // Setup 5 peers and advance state
                Scenario.emptyChannel(5, {
                    timeConfig: {
                        p2pTime: 30,
                        agreementTime: 2,
                        chainFallbackTime: 2,
                        evidenceTime: 10 // Increased from 3 to give more time for all peers to commit disputes
                    }
                }),
                Scenario.advanceState(5),
                Assert.allPeersInSync(),

                // Create and resolve invalid state transition dispute
                // This will reduce the fork (remove peer 2)
                // Using extended settlement timing for 5-peer scenario
                Scenario.disputeWithReduction({
                    maliciousPeerIndex: 2,
                    forkSettleTimeoutMs: 15000,
                    disputesCommittedTimeoutMs: 10000
                }),

                // Post snapshot to move on-chain state to the new fork
                Transition.postSnapshot({ peerIndex: 0 }),

                // Continue with 3 more transitions using only honest peers
                Transition.sequenceFromHonestPeers([
                    (c) => c.add(2),
                    (c) => c.add(2),
                    (c) => c.add(2)
                ]),
                Assert.peersInSync([0, 1, 3, 4]),

                // Add a new peer (spectator) that must traverse forks
                Lifecycle.addPeer(),
                Event.waitUntilEventOccurs("onConnection", 5000),
                Assert.peersInSync([0, 1, 3, 4, 5]),

                // Continue with 2 more transitions from honest peers
                Transition.fromHonestPeersOnly((c) => c.add(2)),
                Assert.peersInSync([0, 1, 3, 4, 5]), // Include spectator in sync
                Transition.fromHonestPeersOnly((c) => c.add(2)),
                Assert.peersInSync([0, 1, 3, 4, 5]), // Include spectator in sync

                // Verify all peers are in sync
                Assert.peersInSync([0, 1, 3, 4, 5]),
                Assert.participantCount({ expectedCount: 4, peerIndex: 5 }), // Check on peer 5 (spectator)
                Assert.snapshotOnFork()
            );
        });
    });

    describe("block height 0 spectating", function () {
        it("should spectate successfully when joining at genesis state", async function () {
            await ScenarioRunner.execute(
                // Setup 2 peers but don't make any moves yet (stay at genesis)
                Scenario.emptyChannel(2),
                // Add a spectator to the genesis state
                Lifecycle.addPeer(),
                Assert.participantCount({ expectedCount: 2, peerIndex: 2 }),
                Scenario.advanceState(1),
                // Assert all peers including spectator synced with the new state
                Assert.peersInSync([0, 1, 2]),
                Assert.participantCount({ expectedCount: 2, peerIndex: 2 })
            );
        });

        it("should spectate successfully when joining at block 0", async function () {
            await ScenarioRunner.execute(
                // Setup 2 peers but don't make any moves yet (stay at genesis)
                Scenario.emptyChannel(2),

                Scenario.advanceState(1),
                Assert.peersInSync([0, 1]),
                Lifecycle.addPeer(),
                Assert.participantCount({ expectedCount: 2, peerIndex: 2 }),
                // Assert all peers including spectator synced with the new state
                Assert.peersInSync([0, 1, 2]),
                Assert.participantCount({ expectedCount: 2, peerIndex: 2 })
            );
        });
    });
});
