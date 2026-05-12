import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { ATransport } from "@/transport";
import { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import { Status } from "@/types";

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

            await h.join.addSpectatorWait();
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

    describe("Spectators before and after dispute", function () {
        it("pre-dispute spectator disconnects from participants after resolve; post-dispute joiner syncs", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            });

            await h.transition.advanceState({ count: 4 });
            //  peer index 4 is spectator
            await h.join.addSpectatorWait();
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, 3, 4]
            });

            const maliciousPeerIndex = 0;
            const honestPeerIndices = [1, 2, 3];

            h.event.resetEventSpies();
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait({
                expectedCount: 1,
                peersIndices: honestPeerIndices
            });

            await h.dispute.resolveDisputeWait({
                honestPeerIndices: honestPeerIndices
            });

            await h.transition.advanceState({
                count: 2,
                waitForPeers: honestPeerIndices,
                waitForFinalization: true
            });

            //  first joiner has observed the dispute and disconnected
            await h.assert.sync.spectatorNoTransportToPeersWait({
                spectatorPeerIndex: 4,
                peerIndices: honestPeerIndices
            });
            //  add a new peer index 5 as spectator
            await h.join.addSpectatorWait();
            const spectatorIndex = [5];

            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices.concat(spectatorIndex)
            });
        });
    });

    describe("Spectator promoted to participant", function () {
        it("via forceInboundJoin", async function () {
            const h = TestSession.getHarness();
            const spectator =
                await h.scenario.spectatorPromotedViaForceInboundWait();
            expect(spectator.stateManager.getStatus()).to.equal(
                Status.PARTICIPATING
            );
            await h.assert.sync.participantCount({
                expectedCount: 4,
                peerIndex: spectator.index
            });
            // Channel keeps moving after the promotion.
            await h.transition.advanceState({ count: 2 });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            h.assert.dispute.noDisputes();
        });

        it("via joinChannel", async function () {
            const h = TestSession.getHarness();
            const joiner =
                await h.scenario.spectatorPromotedViaJoinChannelWait();
            expect(joiner.stateManager.getStatus()).to.equal(
                Status.PARTICIPATING
            );
        });

        it("joinChannel survives dispute on reduced fork", async function () {
            const h = TestSession.getHarness();
            const joiner =
                await h.scenario.spectatorPromotedViaJoinChannelWait();

            const maliciousPeerIndex = 0;
            const honestPeerIndices = [1, joiner.index];

            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait({
                expectedCount: 1,
                peersIndices: honestPeerIndices
            });

            const { newForkId } = await h.dispute.resolveDisputeWait({
                honestPeerIndices,
                forkSettleTimeoutMs: 15000
            });

            const joinerPeer = h.getPeer(joiner.index);
            expect(joinerPeer.stateManager.forkId).to.equal(
                newForkId,
                "Joiner must be on the post-dispute (reduced) fork"
            );
            expect(joinerPeer.stateManager.getStatus()).to.equal(
                Status.PARTICIPATING,
                "Joiner must remain PARTICIPATING after dispute resolution"
            );

            const joinerParticipants =
                await joinerPeer.stateManager.diamondStateMachine.getParticipants();
            expect(joinerParticipants).to.include(
                joiner.address,
                "Joiner must be in getParticipants() on the post-dispute fork"
            );

            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices
            });

            await h.transition.advanceState({
                count: 2,
                waitForPeers: honestPeerIndices,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices
            });
        });
    });

    describe("Concurrent promotion", function () {
        it("parallel joinChannel + forceInboundJoin", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 4,
                    evidenceTime: 6
                }
            });

            const joinerA = await h.join.addSpectatorWait();
            const joinerB = await h.join.addSpectatorWait();
            await h.assert.sync.peersInSyncWait();

            await h.join.joinChannelWait({
                joiner: joinerA,
                existingParticipantSigners: h.peers
                    .slice(0, 3)
                    .map((p) => p.signer)
            });
            await h.join.forceInboundJoinDetached({
                participant: joinerB.address
            });

            await h.transition.advanceState({ count: 3 });

            await h.event.waitUntilPeerStatus(
                joinerA.index,
                Status.PARTICIPATING
            );
            await h.event.waitUntilPeerStatus(
                joinerB.index,
                Status.PARTICIPATING
            );

            for (const joiner of [joinerA, joinerB]) {
                const localParticipants = (
                    await h
                        .getPeer(joiner.index)
                        .stateManager.diamondStateMachine.getParticipants()
                ).map((a) => String(a).toLowerCase());

                expect(localParticipants).to.include(
                    joinerA.address.toLowerCase()
                );
                expect(localParticipants).to.include(
                    joinerB.address.toLowerCase()
                );
                expect(localParticipants.length).to.equal(5);
            }
        });
    });

    describe("forceInboundJoin during dispute", function () {
        it("survives dispute on reduced fork", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            });

            const spectator = await h.join.addSpectatorWait();
            await h.assert.sync.participantCount({
                expectedCount: 3,
                peerIndex: spectator.index
            });
            expect(spectator.stateManager.getStatus()).to.equal(Status.SYNCED);

            // forceInboundJoin appends inbound for the spectator. Status stays SYNCED.
            await h.join.forceInboundJoinWait({
                participant: spectator.address
            });
            expect(spectator.stateManager.getStatus()).to.equal(Status.SYNCED);

            const pendingBefore = await h.channelManager.getPendingParticipants(
                h.channelId
            );
            expect(
                pendingBefore.map((a: unknown) => String(a).toLowerCase())
            ).to.include(spectator.address.toLowerCase());

            // Peer 0 voluntarily self-removes via a valid dispute. Done BEFORE any
            // block consumes the spectator's inbound. agreementTime=4s gives a
            // window where no peer has posted a block yet.
            const leaverIndex = 0;
            h.getPeer(leaverIndex).stateManager.storage.forceExit.setForceExit(
                true
            );
            h.context.leftChannelPeerIndices = [
                ...h.context.leftChannelPeerIndices,
                leaverIndex
            ];
            await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
                markMalicious: false
            });

            const remainingPeerIndices = h
                .getPeersForTransitionSyncBarrier()
                .map((p) => p.index);
            await h.assert.dispute.committedWait({
                peersIndices: remainingPeerIndices,
                expectedCount: 1
            });

            const originalForkId = h.activeForkId!;
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 15000,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });

            await h.assert.snapshot.onChainSnapshotChangedWait({
                previousForkId: originalForkId,
                timeoutMs: 15000
            });

            const onChainParticipants = await h.channelManager.getParticipants(
                h.channelId
            );
            expect(
                onChainParticipants.map((a: unknown) =>
                    String(a).toLowerCase()
                ),
                "spectator's MESSAGE_TYPE_JOIN must be applied during reduction"
            ).to.include(spectator.address.toLowerCase());

            await h.event.waitUntilPeerStatus(
                spectator.index,
                Status.PARTICIPATING
            );
        });
    });

    describe("block height 0 spectating", function () {
        it("should spectate successfully when joining at genesis state", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            await h.join.addSpectatorWait();
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
            await h.join.addSpectatorWait();
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
