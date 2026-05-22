import { MathTestSession as TestSession, sleep } from "@test/harness";
import { tryDecodeCustomError } from "@/utils";
import { expect } from "chai";
import { ethers } from "ethers";
import { Block } from "@/models";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { ATransport } from "@/transport";
import { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";

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

        it("spectate atomic persistence and setState", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 4, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 3,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const spectator = await h.join.addSpectatorWait();
            const spectatorIndex = spectator.index;
            const participantIndices = [0, 1, 2];
            const forkId = h.activeForkId;
            expect(forkId).to.not.be.undefined;

            const staleNextToWrite =
                await spectator.stateManager.diamondStateMachine.getNextToWrite();

            await h.network.disconnectPeer(spectatorIndex);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });

            const sourcePeer = h.peerWithHighestBlock(forkId!);
            const blockToQueue =
                sourcePeer.stateManager.storage.blocks.getLatestBlock(forkId!);
            expect(blockToQueue).to.not.be.undefined;
            expect(blockToQueue!.author).to.not.equal(staleNextToWrite);

            const syncPayload =
                await sourcePeer.stateManager.p2pManager.localRpc.spectateService.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    blockToQueue!.height - 1
                );
            expect(syncPayload).to.not.be.undefined;

            const latestFinalizedSnapshot =
                syncPayload!.milestoneSnapshots.at(-1) ??
                syncPayload!.latestForkGenesisSnapshot;
            expect(Number(latestFinalizedSnapshot.blockHeight)).to.equal(
                blockToQueue!.height - 1
            );

            h.event.resetEventSpies();

            const originalValidateBlockConfirmation =
                spectator.stateManager.validationService.validateBlockConfirmation.bind(
                    spectator.stateManager.validationService
                );
            let didValidateQueuedBlock = false;
            let didValidateQueuedBlockAgainstCorruptedState = false;
            spectator.stateManager.validationService.validateBlockConfirmation =
                (async (
                    ...args: Parameters<
                        typeof spectator.stateManager.validationService.validateBlockConfirmation
                    >
                ) => {
                    const [block] = args;
                    if (block.hash === blockToQueue!.hash) {
                        didValidateQueuedBlock = true;
                        const nextBlockHeight =
                            spectator.stateManager.storage.blocks.getNextBlockHeight(
                                forkId!
                            );
                        const nextToWrite =
                            await spectator.stateManager.diamondStateMachine.getNextToWrite();

                        didValidateQueuedBlockAgainstCorruptedState =
                            nextBlockHeight === blockToQueue!.height &&
                            nextToWrite !== blockToQueue!.author;
                    }

                    return originalValidateBlockConfirmation(...args);
                }) as typeof spectator.stateManager.validationService.validateBlockConfirmation;

            let persistPromise: Promise<{ shouldAbort: boolean }> | undefined;
            let queuedBlockPromise: Promise<boolean> | undefined;
            let mutexLocked = false;

            try {
                await spectator.stateManager.mutex.lock();
                mutexLocked = true;

                queuedBlockPromise = spectator.stateManager.onBlockConfirmation(
                    blockToQueue!.blockConfirmationStruct
                );

                persistPromise =
                    spectator.stateManager.p2pManager.localRpc.spectateService.persistSyncPayload(
                        syncPayload!
                    );

                // allow some time for stuff that's not depenendent on the mutex to execute
                await sleep(100);
                spectator.stateManager.mutex.unlock();
                mutexLocked = false;

                await Promise.allSettled([persistPromise, queuedBlockPromise]);
                await h.event.waitForBlockConfirmationProcessed({
                    peerIndex: spectator.index,
                    blockHash: blockToQueue!.hash,
                    keepConnection: true
                });
                expect(didValidateQueuedBlock).to.equal(true);
                expect(didValidateQueuedBlockAgainstCorruptedState).to.equal(
                    false
                );
                expect(
                    spectator.eventSpies.onInitiatingDispute!.called
                ).to.equal(false);
            } finally {
                if (mutexLocked) {
                    spectator.stateManager.mutex.unlock();
                }
                spectator.stateManager.validationService.validateBlockConfirmation =
                    originalValidateBlockConfirmation as typeof spectator.stateManager.validationService.validateBlockConfirmation;
                await persistPromise?.catch(() => undefined);
                await queuedBlockPromise?.catch(() => undefined);
            }
        });

        it("skips latest state persistence when local storage is already ahead", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 4, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 3,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const spectator = await h.join.addSpectatorWait();
            const forkId = h.activeForkId;
            expect(forkId).to.not.be.undefined;

            await h.transition.advanceState({
                count: 3,
                waitForFinalization: true
            });

            const localLatestBlock =
                spectator.stateManager.storage.blocks.getLatestBlock(forkId!);
            expect(localLatestBlock).to.not.be.undefined;
            expect(localLatestBlock!.height).to.be.greaterThan(0);

            const sourcePeer = h.peerWithHighestBlock(forkId!);
            const syncPayload =
                await sourcePeer.stateManager.p2pManager.localRpc.spectateService.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    localLatestBlock!.height - 1
                );
            expect(syncPayload).to.not.be.undefined;

            const originalUnsafeSetLatestState =
                spectator.stateManager.unsafeSetLatestState.bind(
                    spectator.stateManager
                );
            let didPersistLatestState = false;
            spectator.stateManager.unsafeSetLatestState = (async (
                ...args: Parameters<
                    typeof spectator.stateManager.unsafeSetLatestState
                >
            ) => {
                didPersistLatestState = true;
                return originalUnsafeSetLatestState(...args);
            }) as typeof spectator.stateManager.unsafeSetLatestState;

            try {
                const { shouldAbort } =
                    await spectator.stateManager.p2pManager.localRpc.spectateService.persistSyncPayload(
                        syncPayload!
                    );

                expect(shouldAbort).to.equal(false);
                expect(didPersistLatestState).to.equal(false);
                expect(
                    spectator.stateManager.storage.blocks.getLatestBlock(
                        forkId!
                    )?.hash
                ).to.equal(localLatestBlock!.hash);
            } finally {
                spectator.stateManager.unsafeSetLatestState =
                    originalUnsafeSetLatestState as typeof spectator.stateManager.unsafeSetLatestState;
            }
        });

        it("aborts spectating when a finalized sync block conflicts with storage", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 3,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });

            const spectator = await h.join.addSpectatorWait();
            const spectatorIndex = spectator.index;
            const participantIndices = [0, 1, 2, 3];
            const forkId = h.activeForkId;
            expect(forkId).to.not.be.undefined;

            const spectatorLatestBeforeDisconnect =
                spectator.stateManager.storage.blocks.getLatestBlock(forkId!)
                    ?.height ?? -1;

            await h.network.disconnectPeer(spectatorIndex);
            await h.transition.participantLeaveWait({
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
            await h.transition.advanceState({
                count: 3,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });

            const sourcePeer = h.peerWithHighestBlock(forkId!);
            const sourceLatestBlock =
                sourcePeer.stateManager.storage.blocks.getLatestBlock(forkId!);
            expect(sourceLatestBlock).to.not.be.undefined;

            const syncPayload =
                await sourcePeer.stateManager.p2pManager.localRpc.spectateService.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    sourceLatestBlock!.height
                );
            expect(syncPayload).to.not.be.undefined;
            expect(syncPayload!.stateProof.milestones.length).to.be.greaterThan(
                1
            );

            const latestFinalizedSnapshot =
                syncPayload!.milestoneSnapshots.at(-1) ??
                syncPayload!.latestForkGenesisSnapshot;
            const finalizedHeight = Number(latestFinalizedSnapshot.blockHeight);
            const finalizedBlocks = syncPayload!.stateProof.milestones.flatMap(
                (milestone, index) => {
                    if (
                        index ===
                        syncPayload!.stateProof.milestones.length - 1
                    ) {
                        const finalizedBlockConfirmation =
                            milestone.blockConfirmations[0];
                        return finalizedBlockConfirmation
                            ? [
                                  Block.fromBlockConfirmation(
                                      finalizedBlockConfirmation
                                  )
                              ]
                            : [];
                    }

                    return milestone.blockConfirmations.map(
                        (blockConfirmation) =>
                            Block.fromBlockConfirmation(blockConfirmation)
                    );
                }
            );
            const newFinalizedBlocks = finalizedBlocks.filter(
                (block) =>
                    block.height > spectatorLatestBeforeDisconnect &&
                    block.height <= finalizedHeight
            );
            expect(newFinalizedBlocks.length).to.be.greaterThan(1);

            const blockToConflict = newFinalizedBlocks.at(-1);
            expect(blockToConflict).to.not.be.undefined;

            const conflictingBlockStruct = Codec.decode(
                blockToConflict!.encode(),
                Type.Block
            );
            conflictingBlockStruct.stateSnapshotHash = ethers.keccak256(
                ethers.toUtf8Bytes(`conflict-${blockToConflict!.hash}`)
            );
            const conflictingBlock = await Block.fromBlockStruct(
                conflictingBlockStruct,
                spectator.signer
            );

            expect(conflictingBlock.forkId).to.equal(blockToConflict!.forkId);
            expect(conflictingBlock.height).to.equal(blockToConflict!.height);
            expect(conflictingBlock.hash).to.not.equal(blockToConflict!.hash);

            const storedConflictHash =
                spectator.stateManager.storage.blocks.storeBlock(
                    conflictingBlock,
                    { justPersist: true }
                );
            expect(storedConflictHash).to.equal(conflictingBlock.hash);

            const originalUnsafeSetLatestState =
                spectator.stateManager.unsafeSetLatestState.bind(
                    spectator.stateManager
                );
            let didPersistLatestState = false;
            spectator.stateManager.unsafeSetLatestState = (async (
                ...args: Parameters<
                    typeof spectator.stateManager.unsafeSetLatestState
                >
            ) => {
                didPersistLatestState = true;
                return originalUnsafeSetLatestState(...args);
            }) as typeof spectator.stateManager.unsafeSetLatestState;

            try {
                const { shouldAbort } =
                    await spectator.stateManager.p2pManager.localRpc.spectateService.persistSyncPayload(
                        syncPayload!
                    );

                expect(shouldAbort).to.equal(true);
                expect(didPersistLatestState).to.equal(false);
                for (const block of newFinalizedBlocks) {
                    const storedBlock =
                        spectator.stateManager.storage.blocks.getBlock(
                            block.forkId,
                            block.height
                        );
                    if (block.height === blockToConflict!.height) {
                        expect(storedBlock?.hash).to.equal(
                            conflictingBlock.hash
                        );
                    } else {
                        expect(storedBlock).to.be.undefined;
                    }
                }
            } finally {
                spectator.stateManager.unsafeSetLatestState =
                    originalUnsafeSetLatestState as typeof spectator.stateManager.unsafeSetLatestState;
            }
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
        const concurrentTimeConfig = {
            p2pTime: 2,
            agreementTime: 4,
            chainFallbackTime: 4,
            evidenceTime: 6
        };

        it("joinChannel before forceInboundJoin → both joiners participate", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                timeConfig: concurrentTimeConfig
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
            await h.join.forceInboundJoinObserveDetached({
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

        it("forceInboundJoin before joinChannel → joinChannel reverts ErrorJoinChannelInvalidSignature (pending participant did not sign confirmation)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                timeConfig: concurrentTimeConfig
            });

            const joinerA = await h.join.addSpectatorWait();
            const joinerB = await h.join.addSpectatorWait();
            await h.assert.sync.peersInSyncWait();

            // joinerA pre-signs its confirmation while pending is empty.
            const confirmation = await h.join.buildJoinChannelConfirmation({
                joiner: joinerA,
                channelId: h.channelId,
                existingParticipantSigners: h.peers
                    .slice(0, 3)
                    .map((p) => p.signer)
            });
            const expectedSnapshotHash = await h.query.getOnChainSnapshotHash();

            // forceInboundJoin lands first → joinerB enters the pending set →
            // join threshold becomes {p0, p1, p2, joinerB}; joinerA's pre-signed
            // confirmation has only 3 of 4 required signatures.
            await h.join.forceInboundJoinObserveDetached({
                participant: joinerB.address
            });

            try {
                await joinerA.p2pInstance.p2pSigner.joinChannel(
                    confirmation,
                    expectedSnapshotHash
                );
                expect.fail(
                    "expected joinChannel to revert: pending set changed between confirmation build and submission"
                );
            } catch (e) {
                const customError = tryDecodeCustomError(e);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "ErrorJoinChannelInvalidSignature"
                );
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
                .getPeersExcludingMaliciousAndLeavers()
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
