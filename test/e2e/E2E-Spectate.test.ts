import { TestSession, PeerTestHarness } from "@test/harness";
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
        it("should NOT allow spectate RPC before handshake completes", async function () {
            const harness = TestSession.getHarness();
            await harness.lifecycle.start(2, 0, {
                autoConnect: false,
                timeConfig: {
                    agreementTime: 10,
                    p2pTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 2
                }
            });

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
            await harness.network.connectAllPeers();

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
        });
    });

    describe("Same Fork Spectating", function () {
        it("should spectate successfully when on-chain snapshot is already on the same fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.spectatorJoinedAndSynced();
            await h.transition.advanceState({ count: 3 });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2, 3] });
            await h.assert.sync.participantCount({
                expectedCount: 3,
                peerIndex: 3
            });
            await h.assert.snapshot.onChainSnapshotOnFork();
        });
    });

    describe("Fork Traversal Spectating", function () {
        it("should spectate successfully even when it must traverse forks (dispute -> reduced fork)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(5, 0, {
                timeConfig: {
                    p2pTime: 30,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 5
                }
            });
            await h.transition.advanceState({ count: 5 });
            await h.assert.sync.peersInSyncWait();

            await h.scenario.disputeWithReduction({
                maliciousPeerIndex: 2,
                forkSettleTimeoutMs: 15000,
                disputesCommittedTimeoutMs: 10000
            });

            await h.transition.postSnapshot({ peerIndex: 0 });
            await h.transition.sequenceFromHonestPeers([
                (c) => c.add(2),
                (c) => c.add(2),
                (c) => c.add(2)
            ]);
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 3, 4] });

            await h.addPeer();
            await h.event.waitUntilEventOccurs("onConnection", 5000, [5]);
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 3, 4, 5]
            });

            await h.transition.fromHonestPeersOnly((c) => c.add(2));
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 3, 4, 5]
            });
            await h.transition.fromHonestPeersOnly((c) => c.add(2));
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 3, 4, 5]
            });

            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 3, 4, 5]
            });
            await h.assert.sync.participantCount({
                expectedCount: 4,
                peerIndex: 5
            });
            await h.assert.snapshot.onChainSnapshotOnFork();
        });
    });

    describe("block height 0 spectating", function () {
        it("should spectate successfully when joining at genesis state", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            await h.addPeer();
            await h.assert.sync.participantCount({
                expectedCount: 2,
                peerIndex: 2
            });
            await h.transition.advanceState({ count: 1 });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });
            await h.assert.sync.participantCount({
                expectedCount: 2,
                peerIndex: 2
            });
        });

        it("should spectate successfully when joining at block 0", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            await h.transition.advanceState({ count: 1 });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
            await h.addPeer();
            await h.assert.sync.participantCount({
                expectedCount: 2,
                peerIndex: 2
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });
            await h.assert.sync.participantCount({
                expectedCount: 2,
                peerIndex: 2
            });
        });
    });
});
