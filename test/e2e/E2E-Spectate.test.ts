import { MathTestSession as TestSession } from "@test/harness";
import { tryDecodeCustomError } from "@/utils";
import { expect } from "chai";
import { ethers } from "ethers";
import { Block } from "@/models";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import { waitFor } from "@test/utils/waitFor";

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

            // Peer 1: block handshake completion + install a recording guard on
            // its spectateService (so an incoming spectate RPC is blocked).
            await harness
                .control(peer1)
                .stub.stubBlockHandshakeAndRecordSpectateGuard()
                .request();
            // Peer 0: capture the transport it initiates the handshake over —
            // pre-handshake transports aren't in `openConnections`, so we grab
            // this one to send over before the handshake completes.
            await harness
                .control(peer0)
                .stub.stubCaptureInitHandshakeTransport()
                .request();

            // Establish transports (peer 1's handshake stays blocked, so it
            // never completes); wait until peer 0 has initiated the handshake.
            await harness.network.connectAllPeers();
            await waitFor(
                () =>
                    harness.execOnHost(
                        peer0,
                        (sm) =>
                            !!sm.p2pManager.localRpc.stub
                                .capturedInitHandshakeTransport
                    ),
                5000
            );

            // Peer 0: send a spectate RPC to peer 1 over the captured
            // pre-handshake transport. The body runs host-side.
            await harness.execOnHost(peer0, (sm) => {
                const transport =
                    sm.p2pManager.localRpc.stub.capturedInitHandshakeTransport;
                if (!transport)
                    throw new Error("no captured handshake transport");
                // Fire it as a request over the pre-handshake transport. The
                // guard rejects it before dispatch (recording the block); the
                // rejected promise is expected, so swallow it.
                void sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({
                        channelId: sm.channelId,
                        initTime: Date.now()
                    })
                    .request(transport)
                    .catch(() => {});
            });

            // Peer 1's guard should have blocked it (handshake never completed).
            await waitFor(
                async () =>
                    await harness
                        .control(peer1)
                        .stub.wasSpectateGuardBlocked()
                        .request(),
                2000
            );
            expect(
                await harness
                    .control(peer1)
                    .stub.wasSpectateGuardBlocked()
                    .request()
            ).to.equal(
                true,
                "Guard should have blocked the spectate RPC before handshake completes"
            );
        });
    });

    // NOTE: the former "Channel Binding" test is obsolete. With request/response
    // the spectator uses its own `syncRequest.channelId` to verify the payload
    // and never trusts a channelId echoed by the responder, so a mismatched-
    // channel response is structurally impossible — there is no separate
    // `onSpectateResponse` endpoint to feed a forged channelId into.

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

            const staleNextToWrite = await h
                .control(h.getPeer(spectatorIndex))
                .query.getNextToWrite()
                .request();

            await h.network.disconnectPeer(spectatorIndex);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });

            const sourcePeer = h.getPeer(
                (await h.peerWithHighestBlock(forkId!)).index
            );
            const blockInfo = await h
                .control(sourcePeer)
                .query.getLatestBlockInfo(forkId!)
                .request();
            expect(blockInfo).to.not.be.null;
            const blockHeight = Number(
                Codec.decode(blockInfo!.encodedBlock, Type.Block).transaction
                    .header.transactionCnt
            );
            expect(blockInfo!.author).to.not.equal(staleNextToWrite);
            const blockConfirmationResult = await h
                .control(sourcePeer)
                .query.getLatestBlockConfirmation(forkId!)
                .request();
            const blockConfirmation = blockConfirmationResult
                ? Codec.decode(
                      blockConfirmationResult.encodedBlockConfirmation,
                      Type.BlockConfirmation
                  )
                : null;

            const encodedSyncPayload = await h
                .control(sourcePeer)
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    blockHeight - 1
                )
                .request();
            expect(encodedSyncPayload).to.not.be.null;
            const syncPayload = Codec.decode(
                encodedSyncPayload!,
                Type.SyncPayload
            );
            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(Number(latestFinalizedSnapshot.blockHeight)).to.equal(
                blockHeight - 1
            );

            h.event.resetEventSpies();

            // Drive the atomic interleaving host-side: lock the mutex, queue the
            // block + persist the sync payload behind it, then release. The body
            // runs with the live stateManager, so mutex/validationService/
            // onBlockConfirmation/spectateService are all in-process.
            const result = await h.execOnHost(
                h.getPeer(spectatorIndex),
                async (sm, args) => {
                    const validation = sm.validationService;
                    const original =
                        validation.validateBlockConfirmation.bind(validation);
                    let didValidateQueuedBlock = false;
                    let didValidateQueuedBlockAgainstCorruptedState = false;
                    validation.validateBlockConfirmation = async (
                        entry,
                        strategy
                    ) => {
                        if (String(entry.block.hash) === args.blockHash) {
                            didValidateQueuedBlock = true;
                            const nextBlockHeight =
                                sm.storage.blocks.getNextBlockHeight(
                                    args.forkId
                                );
                            const nextToWrite =
                                await sm.diamondStateMachine.getNextToWrite();
                            didValidateQueuedBlockAgainstCorruptedState =
                                nextBlockHeight === args.blockHeight &&
                                String(nextToWrite) !==
                                    String(args.blockAuthor);
                        }
                        return original(entry, strategy);
                    };
                    try {
                        await sm.mutex.lock();
                        const queuedBlockPromise = sm.onBlockConfirmationStruct(
                            args.blockConfirmation
                        );
                        const decoded =
                            sm.p2pManager.localRpc.spectate.decodeSyncPayload(
                                args.encodedSyncPayload
                            );
                        const persistPromise =
                            sm.p2pManager.localRpc.spectateService.persistSyncPayload(
                                decoded
                            );
                        await new Promise((r) => setTimeout(r, 100));
                        sm.mutex.unlock();
                        await Promise.allSettled([
                            persistPromise,
                            queuedBlockPromise
                        ]);
                        return {
                            didValidateQueuedBlock,
                            didValidateQueuedBlockAgainstCorruptedState
                        };
                    } finally {
                        validation.validateBlockConfirmation = original;
                    }
                },
                {
                    blockHash: blockInfo!.hash,
                    forkId: forkId!,
                    blockHeight,
                    blockAuthor: blockInfo!.author,
                    blockConfirmation: blockConfirmation!,
                    encodedSyncPayload: encodedSyncPayload!
                }
            );

            await h.event.waitForBlockConfirmationProcessed({
                peerIndex: spectatorIndex,
                blockHash: blockInfo!.hash,
                keepConnection: true
            });
            expect(result.didValidateQueuedBlock).to.equal(true);
            expect(result.didValidateQueuedBlockAgainstCorruptedState).to.equal(
                false
            );
            expect(
                h.getPeer(spectatorIndex).eventSpies.onInitiatingDispute!.called
            ).to.equal(false);
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

            const localLatestBlock = await h
                .control(h.getPeer(spectator.index))
                .query.getLatestBlockInfo(forkId!)
                .request();
            expect(localLatestBlock).to.not.be.null;
            const localLatestHeight = Number(
                Codec.decode(localLatestBlock!.encodedBlock, Type.Block)
                    .transaction.header.transactionCnt
            );
            expect(localLatestHeight).to.be.greaterThan(0);

            const sourcePeer = await h.peerWithHighestBlock(forkId!);
            const encodedSyncPayload = await h
                .control(h.getPeer(sourcePeer.index))
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    localLatestHeight - 1
                )
                .request();
            expect(encodedSyncPayload).to.not.be.null;

            await h
                .control(h.getPeer(spectator.index))
                .stub.stubRecordUnsafeSetLatestState()
                .request();

            try {
                const { shouldAbort } = await h
                    .control(h.getPeer(spectator.index))
                    .spectate.persistSyncPayload(encodedSyncPayload!)
                    .request();

                const didPersistLatestState = await h
                    .control(h.getPeer(spectator.index))
                    .stub.wasUnsafeSetLatestStateCalled()
                    .request();

                expect(shouldAbort).to.equal(false);
                expect(didPersistLatestState).to.equal(false);
                expect(
                    await h
                        .control(h.getPeer(spectator.index))
                        .query.getLatestBlockHash(forkId!)
                        .request()
                ).to.equal(localLatestBlock!.hash);
            } finally {
                await h
                    .control(h.getPeer(spectator.index))
                    .stub.restoreUnsafeSetLatestState()
                    .request();
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

            const spectatorLatestInfo = await h
                .control(h.getPeer(spectator.index))
                .query.getLatestBlockInfo(forkId!)
                .request();
            const spectatorLatestBeforeDisconnect = spectatorLatestInfo
                ? Number(
                      Codec.decode(spectatorLatestInfo.encodedBlock, Type.Block)
                          .transaction.header.transactionCnt
                  )
                : -1;

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

            const sourcePeer = await h.peerWithHighestBlock(forkId!);
            const sourceLatestBlock = await h
                .control(h.getPeer(sourcePeer.index))
                .query.getLatestBlockInfo(forkId!)
                .request();
            expect(sourceLatestBlock).to.not.be.null;
            const sourceLatestHeight = Number(
                Codec.decode(sourceLatestBlock!.encodedBlock, Type.Block)
                    .transaction.header.transactionCnt
            );

            const encodedSyncPayload = await h
                .control(h.getPeer(sourcePeer.index))
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    sourceLatestHeight
                )
                .request();
            expect(encodedSyncPayload).to.not.be.null;
            const syncPayload = Codec.decode(
                encodedSyncPayload!,
                Type.SyncPayload
            );
            expect(syncPayload.stateProof.milestones.length).to.be.greaterThan(
                1
            );

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            const finalizedHeight = Number(latestFinalizedSnapshot.blockHeight);
            const finalizedBlocks = syncPayload.stateProof.milestones.flatMap(
                (milestone, index) => {
                    if (
                        index ===
                        syncPayload.stateProof.milestones.length - 1
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

            const storedConflictHash = await h
                .control(h.getPeer(spectator.index))
                .spectate.storeBlockJustPersist(
                    Codec.encode(
                        conflictingBlock.signedBlock,
                        Type.SignedBlock
                    ) as string
                )
                .request();
            expect(storedConflictHash).to.equal(conflictingBlock.hash);

            await h
                .control(h.getPeer(spectator.index))
                .stub.stubRecordUnsafeSetLatestState()
                .request();

            try {
                const { shouldAbort } = await h
                    .control(h.getPeer(spectator.index))
                    .spectate.persistSyncPayload(encodedSyncPayload!)
                    .request();

                const didPersistLatestState = await h
                    .control(h.getPeer(spectator.index))
                    .stub.wasUnsafeSetLatestStateCalled()
                    .request();

                expect(shouldAbort).to.equal(true);
                expect(didPersistLatestState).to.equal(false);
                for (const block of newFinalizedBlocks) {
                    const storedBlockHash = await h
                        .control(h.getPeer(spectator.index))
                        .query.getBlockHashAt(block.forkId, block.height)
                        .request();
                    if (block.height === blockToConflict!.height) {
                        expect(storedBlockHash).to.equal(conflictingBlock.hash);
                    } else {
                        expect(storedBlockHash).to.be.null;
                    }
                }
            } finally {
                await h
                    .control(h.getPeer(spectator.index))
                    .stub.restoreUnsafeSetLatestState()
                    .request();
            }
        });
    });

    describe("Fork Traversal Spectating", function () {
        // TODO(separate-PR): product/protocol bug, NOT a harness-conversion issue.
        // After the dispute reduction all 4 remaining peers agree on the reduced
        // fork's genesis block (identical hash) but it only collects 3/4
        // signatures, so finalization stalls (`sigs=3/4 union=4`). One
        // participant never produces/propagates its block-confirmation signature
        // on the new fork. This path was never exercised before (the throwing
        // stateManager proxy hid it) and reproduces identically inline. Likely a
        // post-reduction P2P signature-propagation / re-sync gap to fix on the
        // product side.
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
        // TODO(separate-PR): flaky due to the same post-dispute-reduction
        // finalization product bug as the "traverse forks" test — after the
        // dispute the reduced fork's genesis block intermittently collects only
        // N-1 of N signatures (e.g. sigs=2/3), so sync stalls. Passes on some
        // runs, fails on others; not a harness-conversion issue.
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
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
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
            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
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
            expect(
                await h.control(joinerPeer).query.getForkId().request()
            ).to.equal(
                newForkId,
                "Joiner must be on the post-dispute (reduced) fork"
            );
            expect(
                await h.control(joinerPeer).query.getStatus().request()
            ).to.equal(
                Status.PARTICIPATING,
                "Joiner must remain PARTICIPATING after dispute resolution"
            );

            const joinerParticipants = await h
                .control(joinerPeer)
                .query.getParticipants()
                .request();
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
                        .control(h.getPeer(joiner.index))
                        .query.getParticipants()
                        .request()
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
            // forceInboundJoin lands first → joinerB enters the pending set →
            // join threshold becomes {p0, p1, p2, joinerB}; joinerA's pre-signed
            // confirmation has only 3 of 4 required signatures.
            await h.join.forceInboundJoinObserveDetached({
                participant: joinerB.address
            });

            try {
                await joinerA.p2pInstance.p2pSigner.joinChannel(confirmation);
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
        // TODO(separate-PR): product bug, NOT a harness-conversion issue. After
        // resolving the dispute on the reduced fork the on-chain snapshot never
        // changes within the timeout (same post-dispute-reduction class as the
        // "traverse forks" test above), and teardown then hits a fatal
        // `onStateSnapshotUpdated: unknown snapshot while status=4` in
        // EventHandler.apply — a slashed peer receiving an unknown snapshot
        // after resolution. Reproduces identically inline; fix on the product
        // side (dispute-resolution snapshot propagation + status=4 teardown
        // handling).
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
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.SYNCED);

            // forceInboundJoin appends inbound for the spectator. Status stays SYNCED.
            await h.join.forceInboundJoinWait({
                participant: spectator.address
            });
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.SYNCED);

            const pendingBefore = await h.channelManager.getPendingParticipants(
                h.channelId
            );
            expect(pendingBefore.map((a) => a.toLowerCase())).to.include(
                spectator.address.toLowerCase()
            );

            // Peer 0 voluntarily self-removes via a valid dispute. Done BEFORE any
            // block consumes the spectator's inbound. agreementTime=4s gives a
            // window where no peer has posted a block yet.
            const leaverIndex = 0;
            await h
                .control(h.getPeer(leaverIndex))
                .dispute.setForceExit(true)
                .request();
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
                onChainParticipants.map((a) => a.toLowerCase()),
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

    describe("Concurrent sync dedup", function () {
        it("collapses two concurrent sync() calls for the same peer into a single on-the-wire request", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2);
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });

            // Count spectate requests arriving at peer 1 (counter resets on
            // install, so only the requests we trigger below are counted).
            const restore = await h.rpcStub.stubCountSpectateRequests(1);

            const peer1Address = h.getPeer(1).address;
            // Fire two sync() calls for the same peer back-to-back on peer 0's
            // host. `sync()` marks `inFlightByPeerAddress` synchronously before
            // sending, so the second call must be dropped before it hits the wire.
            await h.execOnHost(
                h.getPeer(0),
                (sm, args) => {
                    const channelId = sm.channelId;
                    sm.p2pManager.localRpc.spectateService.sync(
                        args.peer1Address,
                        channelId
                    );
                    sm.p2pManager.localRpc.spectateService.sync(
                        args.peer1Address,
                        channelId
                    );
                },
                { peer1Address }
            );

            // Wait for the single request to land, then assert it stayed at one
            // (the deduped second call never produced a second request).
            await waitFor(
                async () => (await h.rpcStub.getSpectateRequestCount(1)) >= 1,
                5000
            );
            expect(await h.rpcStub.getSpectateRequestCount(1)).to.equal(
                1,
                "two concurrent sync() calls for the same peer must collapse to one on-the-wire request"
            );

            await restore();
        });
    });
});
