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
            await harness.lifecycle.start(3, 0, {
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
            const peer2 = harness.peers[2];

            // Peer 1: block handshake completion + install a recording guard on
            // its spectateService (so an incoming spectate RPC is blocked).
            await harness
                .control(peer1)
                .stub.stubBlockHandshakeAndRecordSpectateGuard()
                .request();
            await harness
                .control(peer1)
                .stub.stubCountSpectateRequests()
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
            await harness.network.connectPeers([0, 1]);
            await waitFor(
                () =>
                    harness.execOnHost(
                        peer0,
                        (sm) =>
                            !!sm.p2pManager.localRpc.stub
                                .capturedInitHandshakeTransport
                    ),
                harness.event.protocolEventTimeoutMs()
            );

            // Peer 0: send a request over the captured pre-handshake
            // transport and wait for the guard's request consequence.
            expect(
                await harness
                    .control(peer0)
                    .stub.sendSpectateRequestOverCapturedHandshakeTransport(
                        harness.channelId!.toString(),
                        Date.now()
                    )
                    .request()
            ).to.equal("RPC request rejected by guard");

            // Peer 1's guard should have blocked it (handshake never completed).
            await waitFor(
                async () =>
                    await harness
                        .control(peer1)
                        .stub.wasSpectateGuardBlocked()
                        .request(),
                harness.event.protocolEventTimeoutMs()
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
            expect(
                await harness
                    .control(peer1)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(0);

            expect(
                await harness
                    .control(peer1)
                    .stub.restoreBlockedHandshake()
                    .request()
            ).to.equal(true);
            await harness.network.connectPeers([1, 2]);
            await harness.connectionBarrier.waitFor(
                async () => {
                    const [peer1Connected, peer2Connected] = await Promise.all([
                        harness
                            .control(peer1)
                            .query.isConnectedTo(peer2.address)
                            .request(),
                        harness
                            .control(peer2)
                            .query.isConnectedTo(peer1.address)
                            .request()
                    ]);
                    return peer1Connected && peer2Connected;
                },
                {
                    timeoutMs: harness.event.protocolEventTimeoutMs(),
                    timeoutMessage:
                        "Peers 1 and 2 did not establish a mutual transport after the blocked handshake was restored"
                }
            );

            const response = await harness
                .control(peer2)
                .spectateService.onSpectateRequest({
                    channelId: harness.channelId!.toString(),
                    initTime: Date.now()
                })
                .request(peer1.address);
            expect(response.encodedSyncPayload).to.be.a("string");
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
            await h.lifecycle.start(3, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 3,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const spectator = await h.join.addSpectatorDetached();
            const spectatorIndex = spectator.index;
            const participantIndices = [0, 1, 2];
            await h.transition.advanceState({
                count: 4,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
            await h.event.waitUntilPeerStatus(spectatorIndex, Status.SYNCED);
            await h.assert.sync.peersInSyncWait({
                peerIndices: participantIndices.concat(spectatorIndex)
            });
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

            const syncResult = await h
                .control(sourcePeer)
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    blockHeight - 1
                )
                .request();
            expect(syncResult).to.not.be.null;
            const syncPayload = Codec.decode(
                syncResult!.encodedSyncPayload,
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
                        const queuedBlockPromise =
                            sm.blockIngestService.onBlockConfirmationStruct(
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
                    encodedSyncPayload: syncResult!.encodedSyncPayload
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
            await h.lifecycle.start(3, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 3,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const spectator = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 4,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
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
            const syncResult = await h
                .control(h.getPeer(sourcePeer.index))
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    localLatestHeight - 1
                )
                .request();
            expect(syncResult).to.not.be.null;

            await h
                .control(h.getPeer(spectator.index))
                .stub.stubRecordUnsafeSetLatestState()
                .request();

            try {
                const { shouldAbort } = await h
                    .control(h.getPeer(spectator.index))
                    .spectate.persistSyncPayload(syncResult!.encodedSyncPayload)
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

            const spectator = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2, 3],
                waitForFinalization: true
            });
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
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
            const leaverIndex = await h.transition.participantLeaveDetached({
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
            const remainingParticipantIndices = participantIndices.filter(
                (peerIndex) => peerIndex !== leaverIndex
            );
            await h.transition.advanceState({
                count: 3,
                waitForPeers: remainingParticipantIndices,
                waitForFinalization: true
            });
            await h.event.waitUntilPeerStatus(leaverIndex, Status.SYNCED);

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

            const syncResult = await h
                .control(h.getPeer(sourcePeer.index))
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId!,
                    sourceLatestHeight
                )
                .request();
            expect(syncResult).to.not.be.null;
            const syncPayload = Codec.decode(
                syncResult!.encodedSyncPayload,
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
                    .spectate.persistSyncPayload(syncResult!.encodedSyncPayload)
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
        // TODO(#351): product/protocol bug, NOT a harness-conversion issue.
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

            // Keep this scenario about a bad transition from the valid writer;
            // participant order differs between parallel account allocations.
            const maliciousPeerIndex = (await h.query.getNextPeerToWrite())
                .index;
            const honestPeerIndices = h.peers
                .map((peer) => peer.index)
                .filter((peerIndex) => peerIndex !== maliciousPeerIndex);
            await h.scenario.disputeWithReduction({
                maliciousPeerIndex,
                honestPeerIndices
            });

            // Post from an honest peer: when the rotation makes peer 0 the
            // malicious writer, the slashed peer 0 never reduces and has no
            // genesis for the reduced fork to post from.
            await h.transition.postSnapshot({
                peerIndex: honestPeerIndices[0]
            });
            await h.transition.sequenceFromHonestPeers([
                (c) => c.add(2),
                (c) => c.add(2),
                (c) => c.add(2)
            ]);
            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices
            });

            const spectator = await h.join.addSpectatorDetached();
            await h.transition.fromHonestPeersOnly((c) => c.add(2));
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices.concat(5)
            });
            await h.transition.fromHonestPeersOnly((c) => c.add(2));
            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices.concat(5)
            });

            await h.assert.sync.peersInSyncWait({
                peerIndices: honestPeerIndices.concat(5)
            });
            await h.assert.sync.participantCount({
                expectedCount: 4,
                peerIndex: 5
            });
            await h.assert.snapshot.onChainSnapshotOnFork();
        });
    });

    describe("Spectators before and after dispute", function () {
        // TODO(#351): flaky due to the same post-dispute-reduction
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

            //  peer index 4 is spectator
            const spectator = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 4,
                waitForPeers: [0, 1, 2, 3]
            });
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, 3, 4]
            });

            const maliciousPeerIndex = 0;
            const honestPeerIndices = [1, 2, 3];
            const forkId = h.activeForkId!;

            h.event.resetEventSpies();
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.event.waitUntilPeerStatus(4, Status.OPENED);

            // initiatedAndCommitedWait is flaky when it expects multiple peer to initiate and commit
            // Why? Because peers race and if they commit at the same it is ok
            // If 1 peer commits first and others audit -> it's possible that others hit hasMoreEvidence=false so they don't submit
            await h.dispute.resolveDisputeWait({
                forkId,
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
            const forkId = h.activeForkId!;

            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait({
                expectedCount: 1,
                peersIndices: honestPeerIndices
            });

            const { newForkId } = await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices
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
            p2pTime: 6, // 2s too low for joinChannelWait
            agreementTime: 4,
            chainFallbackTime: 4,
            evidenceTime: 6
        };

        it("joinChannel before forceInboundJoin → both joiners participate", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: concurrentTimeConfig
            });

            // Spectating is asynchronous to the channel: participants author
            // on their own cadence and never wait for joiners to spawn/sync.
            // Spawn both detached, produce the initial blocks immediately,
            // and await SYNCED only right before the joins need it. Blocking
            // spawns between blocks would idle past p2pTime + agreementTime
            // and the post-promotion block would be rejected by the original
            // participants while the joiners accept it, splitting the fork.
            const joinerA = await h.join.addSpectatorDetached();
            const joinerB = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            await h.event.waitUntilPeerStatus(joinerA.index, Status.SYNCED);
            await h.event.waitUntilPeerStatus(joinerB.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait();

            await h.join.joinChannelWait({ joiner: joinerA });
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
            await h.lifecycle.start(3, 0, {
                timeConfig: concurrentTimeConfig
            });

            const joinerA = await h.join.addSpectatorDetached();
            const joinerB = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            await h.event.waitUntilPeerStatus(joinerA.index, Status.SYNCED);
            await h.event.waitUntilPeerStatus(joinerB.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait();

            // joinerA pre-signs its confirmation while pending is empty.
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner: joinerA,
                channelId: h.channelId
            });
            // forceInboundJoin lands first → joinerB enters the pending set →
            // join threshold becomes {p0, p1, p2, joinerB}; joinerA's pre-signed
            // confirmation has only 3 of 4 required signatures.
            await h.join.forceInboundJoinObserveDetached({
                participant: joinerB.address
            });

            try {
                await joinerA.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
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
        // TODO(#352, #353): product bug, NOT a harness-conversion issue. After
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
            await h.lifecycle.start(3, 0, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            });

            const spectator = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
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

            // The compatibility helper submits through the spectator's StateManager.
            await h.join.forceInboundJoinWait({
                participant: spectator.address
            });
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);

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
            const originalForkId = h.activeForkId!;
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
                .getActiveHonestPeers()
                .map((p) => p.index);
            await h.assert.dispute.committedWait({
                peersIndices: remainingPeerIndices,
                expectedCount: 1
            });

            await h.dispute.resolveDisputeWait({
                forkId: originalForkId,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });

            await h.assert.snapshot.localSnapshotsChangedWait({
                previousForkId: originalForkId
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
            // Fire two concurrent startSync calls for the same peer on peer 0.
            // `sync()` marks `inFlightByPeerAddress` synchronously before its
            // background request completes (a full spectate RTT), so the second
            // must be dropped before it hits the wire. Both control round-trips
            // land well inside that window.
            await Promise.all([
                h
                    .control(h.getPeer(0))
                    .spectate.startSync(peer1Address)
                    .request(),
                h
                    .control(h.getPeer(0))
                    .spectate.startSync(peer1Address)
                    .request()
            ]);

            // Wait for the single request to land, then assert it stayed at one
            // (the deduped second call never produced a second request).
            await waitFor(
                async () => (await h.rpcStub.getSpectateRequestCount(1)) >= 1,
                h.event.protocolEventTimeoutMs()
            );
            expect(await h.rpcStub.getSpectateRequestCount(1)).to.equal(
                1,
                "two concurrent sync() calls for the same peer must collapse to one on-the-wire request"
            );

            await restore();
        });
    });

    describe("Unprovable sync target mutually blacklists both peers", function () {
        it("an above-latest target can't be proven, so requester and responder blacklist each other", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2);
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });

            const requester = h.getPeer(0);
            const responder = h.getPeer(1);
            const forkId = h.activeForkId!;

            // Ask for a height far above anything the responder can prove. p2p
            // sync is mutual-cooperation: an unprovable request is a cooperation
            // failure, so the responder cuts the requester (and never serves a
            // downgraded latest-height proof), and the failed request cuts the
            // responder in turn.
            await h
                .control(requester)
                .spectate.startSync(responder.address, forkId, 9999)
                .request();

            await waitFor(
                async () =>
                    await h
                        .control(responder)
                        .query.isBlacklisted(requester.address)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );
            await waitFor(
                async () =>
                    await h
                        .control(requester)
                        .query.isBlacklisted(responder.address)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );
        });
    });

    describe("Exact-target sync payload generation", function () {
        // A targeted sync request pins the proof to the exact (fork, height):
        // `generateSyncPayload(F, h)` must prove height `h`, even when the
        // responder is locally ahead. Height 0 is the regression for the
        // `_blockHeight ?? latestBlockHeight` fix: 0 is falsy, so pre-fix the
        // `||` proved the responder's *latest* height instead of the pinned 0.
        // Height 1 is the truthy-height control that already worked.
        // Driven host-side against the real `generateSyncPayload` so the pin is
        // asserted deterministically at its source (the full sync pipeline
        // normalizes an over-proved height, so it can't distinguish the fix).
        async function expectSyncPayloadPinnedToRequestedHeightWhileAhead(
            requestedHeight: number
        ) {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 10,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            // Advance so the responder is finalized well beyond the target.
            await h.transition.advanceState({
                count: 3,
                waitForFinalization: true
            });

            const responder = h.getPeer(0);
            const forkId = h.activeForkId!;

            // The responder is locally ahead of the requested target.
            const responderLatest = await h
                .control(responder)
                .query.getLatestBlockBundle(forkId)
                .request();
            expect(responderLatest).to.not.equal(null);
            expect(responderLatest!.height).to.be.greaterThan(requestedHeight);

            const syncResult = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId,
                    requestedHeight
                )
                .request();
            expect(syncResult).to.not.equal(null);
            const syncPayload = Codec.decode(
                syncResult!.encodedSyncPayload,
                Type.SyncPayload
            );

            // The proof is pinned to exactly the requested height, not the
            // responder's latest. Pre-fix (height 0 -> `||` -> latest) this
            // is the responder's tip and the assertion fails.
            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(Number(latestFinalizedSnapshot.blockHeight)).to.equal(
                requestedHeight,
                "sync payload must prove exactly the requested height"
            );
        }

        it("pins the sync payload to requested height 0 while ahead", async function () {
            await expectSyncPayloadPinnedToRequestedHeightWhileAhead(0);
        });

        it("pins the sync payload to requested height 1 while ahead", async function () {
            await expectSyncPayloadPinnedToRequestedHeightWhileAhead(1);
        });
        it("pins the sync payload to the exact leave-block height while the responder is ahead", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 10,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const forkId = h.activeForkId!;
            const participantIndices = [0, 1, 2, 3];

            // the requester must be genuinely behind the leave, so cut it
            // before the leave block is produced
            const requester = await h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 1,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
            await h.event.waitUntilPeerStatus(requester.index, Status.SYNCED);
            await h.network.disconnectPeer(requester.index);
            const requesterHeightBefore =
                (await h
                    .control(requester)
                    .query.getLatestBlockHeight(forkId)
                    .request()) ?? -1;

            for (const peerIndex of participantIndices) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubPostStateSnapshot()
                    .request();
            }

            const leaverIndex =
                await h.transition.participantLeaveStateTransition({
                    waitForPeers: participantIndices,
                    waitForFinalization: true
                });
            const remainingPeerIndices = participantIndices.filter(
                (peerIndex) => peerIndex !== leaverIndex
            );
            const responder = h.getPeer(remainingPeerIndices[0]);

            // pin the request to the real participant-set change point instead
            // of to whatever block happens to be latest right after the leave
            const changeHeights = await h
                .control(responder)
                .query.getParticipantChangeHeights(forkId)
                .request();
            expect(
                changeHeights.length,
                "the leave must be the only participant-set change on this fork"
            ).to.equal(1);
            const leaveHeight = changeHeights[0];

            // confirming blocks land above the leave, so the responder is
            // locally ahead of the requested height
            await h.transition.advanceState({
                count: 3,
                waitForPeers: remainingPeerIndices,
                waitForFinalization: true
            });

            // staging sanity: responder genuinely ahead, requester genuinely
            // behind - otherwise the pin below proves nothing
            expect(
                await h
                    .control(responder)
                    .query.getLatestBlockHeight(forkId)
                    .request(),
                "responder must be ahead of the requested height"
            ).to.be.greaterThan(leaveHeight);
            expect(
                requesterHeightBefore,
                "requester must be behind the requested height"
            ).to.be.lessThan(leaveHeight);

            const syncResult = await h
                .control(responder)
                .spectate.generateSyncPayload(h.channelId!, forkId, leaveHeight)
                .request();
            expect(syncResult).to.not.equal(null);
            const syncPayload = Codec.decode(
                syncResult!.encodedSyncPayload,
                Type.SyncPayload
            );

            const milestoneHeights = syncPayload.stateProof.milestones.flatMap(
                (milestone) =>
                    milestone.blockConfirmations.map((confirmation) =>
                        Number(
                            Codec.decode(
                                confirmation.signedBlock.encodedBlock,
                                Type.Block
                            ).transaction.header.transactionCnt
                        )
                    )
            );
            expect(
                milestoneHeights.every((height) => height <= leaveHeight),
                "sync payload milestones must never exceed the requested height"
            ).to.equal(true);

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(
                Number(latestFinalizedSnapshot.blockHeight),
                "the payload must prove exactly the leave height"
            ).to.equal(leaveHeight);

            // the requester runs the real receive side against the payload and
            // must land exactly on the leave, not on the responder's tip
            await h
                .control(requester)
                .spectate.applySyncResponse(
                    responder.address,
                    forkId,
                    leaveHeight,
                    syncResult!.encodedSyncPayload
                )
                .request();

            expect(
                await h.control(requester).query.getStatus().request(),
                "a failed sync aborts the spectator, dropping it out of SYNCED"
            ).to.equal(Status.SYNCED);
            expect(
                await h
                    .control(requester)
                    .query.getLatestBlockHeight(forkId)
                    .request(),
                "requester must complete the sync at exactly the requested height"
            ).to.equal(leaveHeight);
        });
        it("pins the sync payload below a participant leave while the responder is ahead", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0, {
                timeConfig: {
                    p2pTime: 5,
                    agreementTime: 10,
                    chainFallbackTime: 2,
                    evidenceTime: 10
                }
            });

            const forkId = h.activeForkId!;
            const participantIndices = [0, 1, 2, 3];

            // the requester has to be behind the requested height, so take it
            // out before any block is produced
            const requester = await h.join.addSpectatorWait();
            await h.network.disconnectPeer(requester.index);
            const requesterHeightBefore =
                (await h
                    .control(requester)
                    .query.getLatestBlockHeight(forkId)
                    .request()) ?? -1;

            // keep the on-chain snapshot behind the proof: a posted snapshot
            // above the requested height makes the receiver reject the payload
            // before any of this is exercised
            for (const peerIndex of participantIndices) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubPostStateSnapshot()
                    .request();
            }

            await h.transition.advanceState({
                count: 2, // blocks 0..1, below the leave
                waitForPeers: participantIndices,
                waitForFinalization: true
            });

            const leaverIndex =
                await h.transition.participantLeaveStateTransition({
                    waitForPeers: participantIndices,
                    waitForFinalization: true
                });
            const remainingPeerIndices = participantIndices.filter(
                (peerIndex) => peerIndex !== leaverIndex
            );
            const responder = h.getPeer(remainingPeerIndices[0]);

            // confirming blocks land above the leave, so the responder is
            // locally ahead of both the leave and the requested height
            await h.transition.advanceState({
                count: 3,
                waitForPeers: remainingPeerIndices,
                waitForFinalization: true
            });

            const changeHeights = await h
                .control(responder)
                .query.getParticipantChangeHeights(forkId)
                .request();
            expect(
                changeHeights.length,
                "the leave must be the only participant-set change on this fork"
            ).to.equal(1);
            const leaveHeight = changeHeights[0];
            const requestedHeight = leaveHeight - 1;

            // staging sanity: the request is genuinely below the leave, the
            // responder is genuinely above it, and the requester is behind
            expect(
                requestedHeight,
                "the leave must leave a block below it to request"
            ).to.be.greaterThan(-1);
            expect(
                await h
                    .control(responder)
                    .query.getLatestBlockHeight(forkId)
                    .request(),
                "responder must be ahead of the leave"
            ).to.be.greaterThan(leaveHeight);
            expect(
                requesterHeightBefore,
                "requester must be behind the requested height"
            ).to.be.lessThan(requestedHeight);

            const syncResult = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId!,
                    forkId,
                    requestedHeight
                )
                .request();
            expect(syncResult).to.not.equal(null);
            const syncPayload = Codec.decode(
                syncResult!.encodedSyncPayload,
                Type.SyncPayload
            );

            // the leave's change point sits above the request and must not be
            // proven at all - unbounded, its milestone ships blocks from the
            // leave upwards inside a payload answering for a lower height
            const milestoneHeights = syncPayload.stateProof.milestones.flatMap(
                (milestone) =>
                    milestone.blockConfirmations.map((confirmation) =>
                        Number(
                            Codec.decode(
                                confirmation.signedBlock.encodedBlock,
                                Type.Block
                            ).transaction.header.transactionCnt
                        )
                    )
            );
            expect(
                milestoneHeights.every((height) => height <= requestedHeight),
                "sync payload milestones must never reach the leave or above"
            ).to.equal(true);

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(
                Number(latestFinalizedSnapshot.blockHeight),
                "the payload must prove exactly the requested height"
            ).to.equal(requestedHeight);

            // and the real receive side accepts the bounded proof and lands on
            // it, rather than aborting or following the responder's tip
            await h
                .control(requester)
                .spectate.applySyncResponse(
                    responder.address,
                    forkId,
                    requestedHeight,
                    syncResult!.encodedSyncPayload
                )
                .request();

            expect(
                await h.control(requester).query.getStatus().request(),
                "a failed sync aborts the spectator, dropping it out of SYNCED"
            ).to.equal(Status.SYNCED);
            expect(
                await h
                    .control(requester)
                    .query.getLatestBlockHeight(forkId)
                    .request(),
                "requester must complete the sync at exactly the requested height"
            ).to.equal(requestedHeight);
        });
    });

    describe("Spectate request across a dispute-window event gap", function () {
        // A commitment can sit on-chain while the responder's DisputeCommitted
        // event is still undelivered. generateSyncPayload walks the on-chain
        // window, so it must close that gap itself before it reads dispute
        // storage - otherwise the missing-dispute lookup throws and the
        // spectate request dies instead of being answered.
        it("suppressed dispute event on the responder → the on-chain window is recovered and the disputed fork is declined, not proved", async function () {
            const h = TestSession.getHarness();
            const responderIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 1);
            const forkId = h.activeForkId!;

            // freeze the responder's own reduction so it can't close the gap in
            // the background before the spectate request observes it
            const race = await h.rpcStub.holdReductionRace(responderIndex);

            // the responder's own dispute is created locally (so isForkDisputed
            // flips regardless of event delivery), but only the FIRST
            // externally-arriving dispute event is let through - the other
            // honest disputers' commitments stay genuinely missing from storage
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                responderIndex,
                { passFirst: true }
            );

            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedWait({
                peersIndices: [responderIndex, 1, 3]
            });
            // exclude the responder - its own onDisputeCommitted delivery is
            // deliberately held back except for the first event
            await h.assert.dispute.committedWait({ peersIndices: [1, 3] });

            const responder = h.getPeer(responderIndex);
            const responderLatestHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(responderLatestHeight).to.not.equal(null);

            const staged = await h.execOnHost(
                responder,
                async (sm, args) => {
                    const isDisputed =
                        await sm.diamondStateMachine.localDiamondContract.isForkDisputed(
                            sm.channelId,
                            args.forkId
                        );
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    return {
                        isDisputed,
                        commitmentCount: commitments.length,
                        missingBeforeCount: commitments.filter(
                            (c) => !sm.storage.disputes.getDispute(c)
                        ).length
                    };
                },
                { forkId }
            );

            // sanity: the responder really is answering for a disputed fork and
            // really is missing a commitment of that fork's on-chain window
            expect(
                staged.isDisputed,
                "responder must see the fork as disputed"
            ).to.equal(true);
            expect(
                staged.commitmentCount,
                "window must hold commitments"
            ).to.be.greaterThan(0);
            expect(
                staged.missingBeforeCount,
                "at least one commitment must be missing from the responder's storage"
            ).to.be.greaterThan(0);

            let threw = "";
            let syncResult: { encodedSyncPayload: string } | null = null;
            try {
                syncResult = await h
                    .control(responder)
                    .spectate.generateSyncPayload(
                        h.channelId!,
                        forkId,
                        responderLatestHeight!
                    )
                    .request();
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }
            expect(
                threw,
                "generateSyncPayload must recover, not throw"
            ).to.equal("");

            const recovered = await h.execOnHost(
                responder,
                async (sm, args) => {
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const disputes =
                        await sm.agreementManager.getForkDisputes(commitments);
                    return {
                        commitmentCount: commitments.length,
                        missingAfterCount: commitments.filter(
                            (c) => !sm.storage.disputes.getDispute(c)
                        ).length,
                        reducibleDisputeCount: disputes.length
                    };
                },
                { forkId }
            );

            // the recovery really ran: the whole on-chain window is in storage
            // afterwards. events are still held and the responder's reduction is
            // still frozen, so the spectate request is the only thing that could
            // have stored them.
            expect(
                recovered.commitmentCount,
                "the window must not shrink across the call"
            ).to.equal(staged.commitmentCount);
            expect(
                recovered.missingAfterCount,
                "generateSyncPayload must recover every missing dispute before reading confirmations"
            ).to.equal(0);

            expect(
                recovered.reducibleDisputeCount,
                "the recovered window must be reducible in full"
            ).to.equal(recovered.commitmentCount);

            // and the answer itself: with the recovered window the responder
            // reduces to a different tip than the fork it was asked about, so it
            // declines instead of serving a proof for a fork it can't prove.
            expect(
                syncResult,
                "the disputed fork is not the tip the recovered window reduces to"
            ).to.be.null;

            // the peer-observable part: let the responder finish the reduction
            // it just gathered the window for, with its dispute events STILL
            // held. It can only land on the same fork as the honest peers
            // because the window came from the chain - a reduce over the subset
            // its own event feed delivered produces a different fork.
            await race.release({ replayEvents: false, runHeldTasks: true });

            await h.assert.dispute.reductionCompletedWait({
                sourceForkId: forkId,
                peerIndices: [responderIndex, 1, 3]
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [responderIndex, 1, 3]
            });

            const forkIds = await Promise.all(
                [responderIndex, 1, 3].map((peerIndex) =>
                    h.control(h.getPeer(peerIndex)).query.getForkId().request()
                )
            );
            expect(
                new Set(forkIds).size,
                "the responder must reduce to the same fork as the honest peers"
            ).to.equal(1);
            expect(
                forkIds[0],
                "the reduced fork must not be the disputed one"
            ).to.not.equal(forkId);

            await restoreEvents(false);
            await h.rpcStub.cancelScheduledReductions(responderIndex);
        });
    });
});
