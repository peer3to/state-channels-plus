import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import { freshSpectatorStopsOnPayload } from "@test/fixtures/HistoricSyncStaging";
import {
    assertOffChainPromotion,
    assertVerifiedSyncPromotion,
    assertPromotionBeforeReceiverApplication
} from "@test/fixtures/OffChainPromotionFixture";
import { expectSyncPayloadAboveRequestedHeightWhileAhead } from "@test/fixtures/PinnedSyncStaging";
import {
    assertSpectatorSilence,
    assertSpectatorRejectedWork
} from "@test/fixtures/SpectatorSilenceFixture";
import {
    constructProof,
    constructRecordingChainProofReads,
    postSnapshotAt
} from "@test/fixtures/StateProofConstructionStaging";
import {
    servedPayload,
    stageRepeatedTailPayloads,
    syncSpectatorOnServedPayload
} from "@test/fixtures/SyncCompletionStaging";
import {
    failInitialSyncVerification,
    forgedAdoptedStatePayload,
    missingBlockHeights,
    placeholderPayload,
    servedEarlierStatePayload,
    stageCompactSyncedSpectator,
    stageLaggingSpectator,
    syncFromServedPayload,
    syncSpectatorAfterUnpostedLeave
} from "@test/fixtures/SyncVerificationStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * E2E Tests for Spectate Service
 *
 * Maps to: src/rpc/network/services/spectate/SpectateService.ts
 *          src/rpc/network/services/spectate/SpectateRpcMethods.ts
 *          src/stateManager/validationStrategy/SpectatingValidationStrategy.ts
 *
 * Tests spectator joining, syncing, and fork traversal mechanisms.
 */
describe("E2E: Spectate Service", function () {
    it("overlapping newcomer gossip waits for its membership proof without blacklisting", async () => {
        await assertPromotionBeforeReceiverApplication(true);
    });
    it("spectator rejects an invalid envelope without executing or relaying it", async () => {
        await assertSpectatorRejectedWork("invalid");
    });
    it("spectator parks not-ready work without executing or relaying it", async () => {
        await assertSpectatorRejectedWork("not-ready");
    });

    it("new participant gossip can precede another peer applying insertion", async () => {
        await assertPromotionBeforeReceiverApplication();
    });
    it("verified sync promotes an off-chain inserted spectator before chain membership changes", async () => {
        await assertVerifiedSyncPromotion();
    });
    it("spectators apply fresh and late confirmations without relaying and still serve sync", async () => {
        await assertSpectatorSilence();
    });
    it("spectator becomes participant through an off-chain balance transfer", async () => {
        await assertOffChainPromotion(TestSession.getHarness());
    });

    it("full-capacity insertion advances the turn without promoting a spectator", async () => {
        await assertOffChainPromotion(TestSession.getHarness(), true);
    });

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
                    channelId: harness.channelId!.toString()
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

            const participantIndices = [0, 1, 2];
            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: participantIndices,
                minimumBlocks: 4,
                maximumBlocks: 20,
                waitForFinalization: true
            });
            const spectatorIndex = spectator.index;
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

            await h.network.blacklistAndDisconnectPeer(spectatorIndex);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });

            const sourcePeer = h.getPeer(
                (await h.peerWithHighestBlock(forkId!)).index
            );
            const syncResult = await h
                .control(sourcePeer)
                .spectate.generateSyncPayload(h.channelId!, forkId!, 0)
                .request();
            await h.transition.advanceState({
                count: 1,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
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
                        const persistPromise =
                            sm.p2pManager.localRpc.spectateService.applySyncResponse(
                                args.source,
                                {
                                    channelId: sm.channelId,
                                    forkId: args.forkId
                                },
                                args.encodedSyncPayload
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
                    encodedSyncPayload: syncResult!.encodedSyncPayload,
                    source: sourcePeer.address
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

            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 4,
                maximumBlocks: 20,
                waitForFinalization: true
            });
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
                const accepted = await h
                    .control(h.getPeer(spectator.index))
                    .spectate.applySyncResponse(
                        h.getPeer(sourcePeer.index).address,
                        forkId!,
                        localLatestHeight - 1,
                        syncResult!.encodedSyncPayload
                    )
                    .request();

                const didPersistLatestState = await h
                    .control(h.getPeer(spectator.index))
                    .stub.wasUnsafeSetLatestStateCalled()
                    .request();

                expect(accepted).to.equal(true);
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
    });

    describe("Synced proof reconstruction", function () {
        it("spectate sync persists enough data to reconstruct and verify a proof on chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            expect(
                await h.transition.postSnapshotWait({
                    peerIndex: 0,
                    forkId: String(h.activeForkId)
                })
            ).to.not.equal(undefined);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const spectator = await h.join.addSpectatorWait();
            expect(
                (await constructProof(h, spectator.index)).chainValid
            ).to.equal(true);
        });

        it("synced peer preserves proof reconstruction after progress and later anchor adoption", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const spectator = h.getPeer(
                (await h.join.addSpectatorWait()).index
            );
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const afterProgress = await constructProof(h, spectator.index);
            expect(afterProgress.chainValid).to.equal(true);
            expect(
                await h.transition.postSnapshotWait({
                    peerIndex: 0,
                    forkId: String(h.activeForkId)
                })
            ).to.not.equal(undefined);
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const afterAdoption = await constructProof(h, spectator.index);
            expect(afterAdoption.chainValid).to.equal(true);
            expect(afterAdoption.latestProofHeight).to.be.greaterThan(
                afterProgress.latestProofHeight!
            );
        });
    });

    describe("Sync verification and completion", function () {
        it("an initial sync whose proof walk read fails aborts the spectator without excluding anyone; a fresh spectator syncs once the read recovers", async function () {
            const h = TestSession.getHarness();
            const { spectator, participants, forkId, latestHeight } =
                await failInitialSyncVerification(h);
            // the failed initial load ends the spectator's connect attempt
            await TestSession.expectFirstDetachedError({
                includes: "connectToChannel failed",
                timeoutMs: h.event.protocolEventTimeoutMs()
            });
            await TestSession.settleDetached({
                expectedErrorIncludes: "connectToChannel failed"
            });
            expect(spectator.eventSpies.onAbort?.callCount).to.equal(1);
            // a read failure is no verdict against the responder
            for (const participant of participants)
                expect(
                    await h
                        .control(participant)
                        .query.isBlacklisted(spectator.address)
                        .request()
                ).to.equal(false);

            const retried = h.getPeer((await h.join.addSpectatorWait()).index);
            const query = h.control(retried).query;
            expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
                latestHeight
            );
            for (const participant of participants) {
                expect(
                    await query.isBlacklisted(participant.address).request()
                ).to.equal(false);
                expect(
                    await h
                        .control(participant)
                        .query.isBlacklisted(retried.address)
                        .request()
                ).to.equal(false);
            }
            await TestSession.settleDetached();
        });

        it("a lagging spectator rejects a served state below its own final point and blacklists the responder, also when the served tail would replay past that point; an honest head payload completes the sync", async function () {
            const h = TestSession.getHarness();
            const {
                spectator,
                forkId,
                finalHeight,
                latestHeight,
                encodedEarlyPayload
            } = await stageLaggingSpectator(h);
            const query = h.control(spectator).query;
            const stateBefore = await query
                .getLatestStateMachineStateHash(forkId)
                .request();
            // the walk starts at the spectator's own final point: a state
            // served below it is a stale sync proof
            const stale = {
                synced: false,
                rejections: ["served state below the proof start"],
                blacklisted: true,
                latestHeight: finalHeight
            };

            // a history ending below the final point
            expect(
                await syncFromServedPayload(
                    h,
                    spectator,
                    h.getPeer(1),
                    encodedEarlyPayload,
                    forkId,
                    latestHeight
                )
            ).to.deep.equal(stale);

            // an earlier state whose tail reaches past the final point:
            // nothing below the start is replayed or persisted
            const responder = h.getPeer(0);
            expect(
                await syncFromServedPayload(
                    h,
                    spectator,
                    responder,
                    await servedEarlierStatePayload(
                        h,
                        responder,
                        forkId,
                        finalHeight
                    ),
                    forkId,
                    latestHeight
                )
            ).to.deep.equal(stale);
            expect(
                await query.getLatestStateMachineStateHash(forkId).request()
            ).to.equal(stateBefore);

            const honest = h.getPeer(2);
            expect(
                await syncFromServedPayload(
                    h,
                    spectator,
                    honest,
                    Codec.encode(
                        await servedPayload(h, honest, forkId),
                        Type.SyncPayload
                    ) as string,
                    forkId,
                    latestHeight
                )
            ).to.deep.equal({
                synced: true,
                rejections: [],
                blacklisted: false,
                latestHeight
            });
            expect(
                await query.getLatestStateMachineStateHash(forkId).request()
            ).to.equal(
                await h
                    .control(honest)
                    .query.getLatestStateMachineStateHash(forkId)
                    .request()
            );
            expect(
                (await constructProof(h, spectator.index)).chainValid
            ).to.equal(true);
        });

        it("compact synchronized history constructs dispute without gap blocks", async function () {
            const h = TestSession.getHarness();
            const { spectator, forkId, anchorHeight, latestHeight } =
                await stageCompactSyncedSpectator(h);
            // only the threshold block far above the start is stored
            expect(
                await missingBlockHeights(h, spectator, forkId, 0, latestHeight)
            ).to.deep.equal(
                Array.from({ length: latestHeight }, (_, height) => height)
            );

            const proof = await constructProof(h, spectator.index);
            expect(proof.startHeight).to.equal(anchorHeight);
            expect(proof.milestones).to.deep.equal([[latestHeight]]);
            expect(proof.chainValid).to.equal(true);
            const dispute = await constructRecordingChainProofReads(
                h,
                spectator.index
            );
            expect(dispute.error).to.equal(null);
            expect(dispute.carriesHeadProof).to.equal(true);
        });

        it("a forged adopted-state response has no storage effects; an unused placeholder below the requester's final point is ignored", async function () {
            const h = TestSession.getHarness();
            const { spectator, forkId, finalHeight, latestHeight } =
                await stageLaggingSpectator(h);
            const query = h.control(spectator).query;
            const stateBefore = await query
                .getLatestStateMachineStateHash(forkId)
                .request();
            const honest = await servedPayload(h, h.getPeer(0), forkId);

            const forged = await forgedAdoptedStatePayload(h, honest);
            expect(
                await syncFromServedPayload(
                    h,
                    spectator,
                    h.getPeer(0),
                    forged.encodedSyncPayload,
                    forkId,
                    latestHeight
                )
            ).to.deep.equal({
                synced: false,
                rejections: ["milestones invalid"],
                blacklisted: true,
                latestHeight: finalHeight
            });
            expect(
                await query
                    .getStateSnapshotStructByHash(forged.forgedSnapshotHash)
                    .request()
            ).to.equal(null);
            expect(
                await query.getLatestStateMachineStateHash(forkId).request()
            ).to.equal(stateBefore);

            const placeholderHeight = finalHeight - 1;
            const placeholder = placeholderPayload(honest, placeholderHeight);
            expect(
                await syncFromServedPayload(
                    h,
                    spectator,
                    h.getPeer(1),
                    placeholder.encodedSyncPayload,
                    forkId,
                    latestHeight
                )
            ).to.deep.equal({
                synced: true,
                rejections: [],
                blacklisted: false,
                latestHeight
            });
            const honestAtPlaceholder = await h
                .control(h.getPeer(1))
                .query.getBlockHashAt(forkId, placeholderHeight)
                .request();
            expect(honestAtPlaceholder).to.not.equal(placeholder.plantedHash);
            expect(
                await query.getBlockHashAt(forkId, placeholderHeight).request()
            ).to.equal(honestAtPlaceholder);
            expect(
                await query
                    .getStateSnapshotStructByHash(
                        placeholder.plantedSnapshotHash
                    )
                    .request()
            ).to.equal(null);
        });

        it("a repeated tail run cannot pre-store its forged block: its transition runs and stops a fresh spectator; the valid repeated run persists after replay", async function () {
            const h = TestSession.getHarness();
            const { forkId, responder, repeated, repeatedForged, runHeights } =
                await stageRepeatedTailPayloads(h);
            const tailHeights = runHeights.slice(1);
            expect(
                await freshSpectatorStopsOnPayload(h, repeatedForged)
            ).to.equal(true);

            const spectator = await syncSpectatorOnServedPayload(h, repeated);
            // SYNCED is set when the history is persisted, before the tail
            // replay runs: wait for the replay to reach the responder's tip
            await h.assert.sync.peersInSyncWait({
                peerIndices: [responder.index, spectator.index]
            });
            const query = h.control(spectator).query;
            const responderQuery = h.control(responder).query;
            expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
                tailHeights.at(-1)
            );
            for (const height of tailHeights)
                expect(
                    await query.getBlockHashAt(forkId, height).request()
                ).to.equal(
                    await responderQuery
                        .getBlockHashAt(forkId, height)
                        .request()
                );
            expect(
                await query.getLatestStateMachineStateHash(forkId).request()
            ).to.equal(
                await responderQuery
                    .getLatestStateMachineStateHash(forkId)
                    .request()
            );
        });

        it("sync after an unposted leave persists the change point and separated milestones; reconstruction stays chain-valid after progress and after adopting the exit snapshot", async function () {
            const h = TestSession.getHarness();
            const { spectator, remaining, changeHeight, forkId, latestHeight } =
                await syncSpectatorAfterUnpostedLeave(h);
            const query = h.control(spectator).query;
            expect(
                await query.getParticipantChangeHeights(forkId).request()
            ).to.deep.equal([changeHeight]);
            // separated runs: the change block and the head, no gap blocks
            expect(
                await missingBlockHeights(h, spectator, forkId, 0, latestHeight)
            ).to.deep.equal(
                Array.from(
                    { length: latestHeight + 1 },
                    (_, height) => height
                ).filter(
                    (height) =>
                        height !== changeHeight && height !== latestHeight
                )
            );
            const synced = await constructProof(h, spectator.index);
            expect(synced.startHeight).to.equal(0);
            expect(synced.milestones).to.deep.equal([
                [changeHeight],
                [latestHeight]
            ]);
            expect(synced.chainValid).to.equal(true);
            expect(
                (await constructRecordingChainProofReads(h, spectator.index))
                    .error
            ).to.equal(null);

            await h.transition.advanceState({
                count: 1,
                waitForPeers: remaining,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [...remaining, spectator.index]
            });
            const afterProgress = await constructProof(h, spectator.index);
            expect(afterProgress.milestones[0]).to.deep.equal([changeHeight]);
            expect(afterProgress.latestProofHeight).to.equal(latestHeight + 1);
            expect(afterProgress.chainValid).to.equal(true);

            // the exit snapshot lands above the change point
            const anchor = await postSnapshotAt(
                h,
                remaining[0],
                latestHeight + 1
            );
            await waitFor(
                async () =>
                    (await constructProof(h, spectator.index)).startHeight ===
                    anchor.blockHeight,
                h.event.protocolEventTimeoutMs()
            );
            await h.transition.advanceState({
                count: 1,
                waitForPeers: remaining,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [...remaining, spectator.index]
            });
            const afterAdoption = await constructProof(h, spectator.index);
            expect(afterAdoption.startHeight).to.equal(anchor.blockHeight);
            expect(Math.min(...afterAdoption.milestones.flat())).to.be.at.least(
                anchor.blockHeight
            );
            expect(afterAdoption.latestProofHeight).to.equal(latestHeight + 2);
            expect(afterAdoption.chainValid).to.equal(true);
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

            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: honestPeerIndices,
                minimumBlocks: 1,
                maximumBlocks: 20,
                authorBlock: () =>
                    h.transition.fromHonestPeersOnly((c) => c.add(2))
            });
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
        it("pre-dispute spectator disconnects after resolve; post-dispute joiner syncs from surviving honest responders", async function () {
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
            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2, 3],
                minimumBlocks: 4,
                maximumBlocks: 20
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, 3, 4]
            });

            const maliciousPeerIndex = 0;
            const honestPeerIndices = [1, 2, 3];
            const forkId = h.activeForkId!;

            const reductionHolds = await Promise.all(
                [maliciousPeerIndex, ...honestPeerIndices].map((peerIndex) =>
                    h.rpcStub.holdReductionAttempt(peerIndex, "submit")
                )
            );
            try {
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
                //  add a new peer index 5 as spectator. Authoring through the
                // spawn keeps the writer slot alive: an idle slot let a participant
                // time out the next writer on the reduced fork, a second reduction
                // ran, and the joiner's initial sync landed between the chain's new
                // result and the responder's convergence.
                // Finalize without advancing the chain snapshot, so the joiner must
                // traverse a supplied window whose reduction calldata can be omitted.
                expect(
                    await h.scenario.finalizeReductionOnChainOnly(1, forkId)
                ).to.equal(true);
                const { peer: postDisputeSpectator } =
                    await h.join.addSpectatorAuthoring({
                        beforeConnect: async (peer) => {
                            // The held chain snapshot still names the removed peer.
                            // This case checks a surviving participant's final-window proof.
                            // Withdraw discovery: this new peer has no profile to blacklist yet.
                            await h
                                .control(h.getPeer(maliciousPeerIndex))
                                .network.leaveSelectedKey(
                                    h.channelId!.toString()
                                )
                                .request();
                            await h
                                .control(peer)
                                .stub.recordSyncReductionWindows()
                                .request();
                        },
                        authoringPeerIndices: honestPeerIndices,
                        minimumBlocks: 1,
                        maximumBlocks: 20,
                        waitForFinalization: true
                    });
                const reductionInputs = await h
                    .control(postDisputeSpectator)
                    .stub.getSyncReductionWindows()
                    .request();
                await h
                    .control(postDisputeSpectator)
                    .stub.restoreSyncReductionWindows()
                    .request();
                expect(
                    reductionInputs.some((entry) =>
                        entry.suppliedForks.includes(forkId)
                    )
                ).to.equal(true);
                expect(
                    reductionInputs.every(
                        (entry) => entry.reductionForks.length === 0
                    )
                ).to.equal(true);
                const spectatorIndex = [5];

                await h.assert.sync.peersInSyncWait({
                    peerIndices: honestPeerIndices.concat(spectatorIndex)
                });
            } finally {
                await Promise.all(reductionHolds.map((hold) => hold.release()));
            }
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
            // The bounded spawn keeps them authoring through each spawn and
            // sync. Blocking spawns between blocks would idle past
            // p2pTime + agreementTime and the post-promotion block would be
            // rejected by the original participants while the joiners accept
            // it, splitting the fork.
            const { peer: joinerA } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 2,
                maximumBlocks: 20
            });
            const { peer: joinerB } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 0,
                maximumBlocks: 20
            });
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

        it("forceInboundJoin before joinChannel → joinChannel reverts ErrorJoinChannelConfirmationNotThresholdSigned (pending participant did not sign confirmation)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: concurrentTimeConfig
            });

            // Spawn-only, classified (plan 30 item 5): no transition is scheduled until
            // the advanceState below, so no author's window is blocked; a block produced
            // up front would cap the next timestamp and be rejected as stale.
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

            // Pin which revert the client path is reacting to. Every name in
            // the MembershipService abort switch produces the same
            // OPENED/disposed pair, so the status assertions below cannot tell
            // them apart; this static call does.
            let thresholdRevert: unknown;
            try {
                await h.channelManager
                    .connect(joinerA.signer)
                    .joinChannel.staticCall(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    );
                expect.fail(
                    "expected joinChannel to revert: joinerA's pre-signed confirmation is missing the pending participant's signature"
                );
            } catch (e) {
                thresholdRevert = e;
            }
            const thresholdError = expectDecodedError(
                thresholdRevert,
                "ErrorJoinChannelConfirmationNotThresholdSigned",
                "joinChannel must reject the sub-threshold confirmation by name"
            );
            expect(thresholdError.errorDescription.args.participant).to.equal(
                joinerA.address
            );
            // The payload carries the two compared sets, so the missing signer
            // is identifiable: forceInboundJoin widened the threshold to the
            // three participants plus joinerB, while joinerA's pre-signed
            // confirmation still only recovers to the three participants.
            const originalParticipants = [0, 1, 2].map(
                (peerIndex) => h.getPeer(peerIndex).address
            );
            const thresholdParticipants = [
                ...thresholdError.errorDescription.args.thresholdParticipants
            ];
            const confirmationSigners = [
                ...thresholdError.errorDescription.args.signers
            ];
            expect(thresholdParticipants).to.have.members([
                ...originalParticipants,
                joinerB.address
            ]);
            expect(confirmationSigners).to.have.members(originalParticipants);
            expect(confirmationSigners).to.not.include(joinerB.address);

            expect(
                await joinerA.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(false);
            // The abort path sets OPENED itself, so the terminal status alone
            // says nothing about the two cleanup effects the terminal-revert
            // branch owes before aborting: restoring SYNCED and clearing the
            // force-join marker. Status hooks cross the runtime port ahead of
            // the joinChannel response, so the transient restore is still
            // observable here, and the abort follows it rather than replacing
            // it: without the restore the peer would go straight from
            // PENDING_PARTICIPANT to OPENED and neither index would be found.
            const statusChanges = (
                joinerA.eventSpies.onStatusChanged?.getCalls() ?? []
            ).map((call): [Status, Status] => [call.args[0], call.args[1]]);
            const restoredSyncedIndex = statusChanges.findIndex(
                ([oldStatus, newStatus]) =>
                    oldStatus === Status.PENDING_PARTICIPANT &&
                    newStatus === Status.SYNCED
            );
            expect(restoredSyncedIndex).to.be.greaterThan(-1);
            const abortedIndex = statusChanges.findIndex(
                ([oldStatus, newStatus], index) =>
                    index > restoredSyncedIndex &&
                    oldStatus === Status.SYNCED &&
                    newStatus === Status.OPENED
            );
            expect(abortedIndex).to.be.greaterThan(restoredSyncedIndex);

            const failedJoinState = await h.execOnHost(
                h.getPeer(joinerA.index),
                async (stateManager) => ({
                    status: stateManager.status,
                    isDisposed: stateManager.isDisposed,
                    joinSubmissionBlockHeight:
                        stateManager.storage.forceJoin.getJoinSubmissionBlockHeight()
                }),
                {}
            );
            expect(failedJoinState.status).to.equal(Status.OPENED);
            expect(failedJoinState.isDisposed).to.equal(true);
            // joinChannel recorded the submission height before submitting; the
            // terminal branch must drop it, otherwise the dead join keeps a
            // force-join trigger height on record.
            expect(failedJoinState.joinSubmissionBlockHeight).to.equal(
                undefined
            );
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

            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 2,
                maximumBlocks: 20
            });
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
            const remainingPeerIndices =
                await h.dispute.selfRemoveViaDisputeWait({ leaverIndex });

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
            // Spawn-only, classified (plan 30 item 5): genesis spectating is the
            // subject and no transition is scheduled while the spawn runs.
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
            // Create the process before block 0 starts the live writer clock.
            const spectator = await h.join.createSpectatorPeer();
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1],
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
            await h.join.connectSpectator(spectator);
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
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
            // must share the pending result. Both control round-trips
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
        it("an above-latest target can't be proven, so the responder blacklists the requester and the requester strikes the responder", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2);
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });

            const requester = h.getPeer(0);
            const responder = h.getPeer(1);
            const forkId = h.activeForkId!;

            // Ask for a height far above anything the responder can prove. p2p
            // sync is mutual-cooperation: an unprovable request is a cooperation
            // failure, so the responder cuts the requester (and never serves a
            // downgraded latest-height proof). The refusal is not proof of the
            // responder's misbehaviour, so the requester only strikes it.
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
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: requester,
                target: responder
            });
        });
    });

    describe("Minimum-height sync payload generation", function () {
        it("serves the latest sync payload for minimum height 0 while ahead", async function () {
            await expectSyncPayloadAboveRequestedHeightWhileAhead(
                TestSession.getHarness(),
                0
            );
        });

        it("serves a newer sync payload when the minimum is the leave-block height", async function () {
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
            const { peer: requester } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: participantIndices,
                minimumBlocks: 1,
                maximumBlocks: 20,
                waitForFinalization: true
            });
            await h.network.blacklistAndDisconnectPeer(requester.index);
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

            const responderHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
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
                milestoneHeights.every((height) => height <= responderHeight!),
                "sync payload milestones must not exceed the responder height"
            ).to.equal(true);

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(
                Number(latestFinalizedSnapshot.blockHeight),
                "the payload must prove the responder height"
            ).to.equal(responderHeight);

            // The real receive side verifies the leave and adopts the newer proof.
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
                "requester must complete the sync at the responder height"
            ).to.equal(responderHeight);
        });
        it("serves a newer sync payload across a leave above the minimum height", async function () {
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
            // Spawn-only, classified (plan 30 item 5): the requester must precede
            // every block, so nothing authors while it spawns.
            const requester = await h.join.addSpectatorWait();
            await h.network.blacklistAndDisconnectPeer(requester.index);
            const requesterHeightBefore =
                (await h
                    .control(requester)
                    .query.getLatestBlockHeight(forkId)
                    .request()) ?? -1;

            // Keep snapshot posting separate so this case exercises proof replay across the leave.
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

            const responderHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
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

            // The newer proof includes the participant change above the minimum.
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
                milestoneHeights.every((height) => height <= responderHeight!),
                "sync payload milestones must not exceed the responder height"
            ).to.equal(true);

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.at(-1) ??
                syncPayload.latestForkGenesisSnapshot;
            expect(
                Number(latestFinalizedSnapshot.blockHeight),
                "the payload must prove the responder height"
            ).to.equal(responderHeight);

            // The receiver must accept the proved state across the participant change.
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
                "requester must complete the sync at the responder height"
            ).to.equal(responderHeight);
        });
    });

    describe("Spectate request across a dispute-window event gap", function () {
        // A commitment can sit on-chain while the responder's DisputeCommitted
        // event is still undelivered. generateSyncPayload walks the on-chain
        // window, so it must close that gap itself before it reads dispute
        // storage - otherwise the missing-dispute lookup throws and the
        // spectate request dies instead of being answered.
        it("suppressed dispute event on the responder → the on-chain window is recovered and its successor is proved", async function () {
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

            // a window is served only once its kill period expired
            await h.assert.dispute.killPeriodExpiredWait(
                forkId,
                responderIndex
            );

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

            // The recovered reduction supplies a successor proof before installation.
            expect(syncResult).to.not.be.null;
            const provedSuccessor = Codec.decode(
                syncResult!.encodedSyncPayload,
                Type.SyncPayload
            ).latestForkGenesisSnapshot.forkId;
            expect(provedSuccessor).to.not.equal(forkId);

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

            expect(forkIds[0]).to.equal(provedSuccessor);
            await restoreEvents();
            await h.rpcStub.cancelScheduledReductions(responderIndex);
        });

        it("a spectator sees posted junk calldata → no forced timeout check and it stays synced", async function () {
            const h = TestSession.getHarness();
            await h.scenario.spectatorJoinedAndSynced();
            const spectator = h.getPeer(3);
            const forkId = h.activeForkId!;
            // the participants' own disputes would move the spectator's fork
            await h.dispute.suppressDisputeInitiation([0, 1, 2]);
            const writerAddress = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            const writer = h.peers.find((p) => p.address === writerAddress)!;
            const height = await h
                .control(spectator)
                .query.getNextBlockHeight(forkId)
                .request();
            const tasks = await h.rpcStub.recordScheduledTasks(spectator.index);
            try {
                h.event.resetEventSpies();
                await h.byzantine.postJunkCalldataOnChain(writer.index, {
                    height
                });
                await h.event.waitUntilEventOccurs(
                    "onBlockCalldataPosted",
                    undefined,
                    [spectator.index]
                );
                // a spectator judges posted calldata with the spectating
                // strategy: it never asks for a timeout
                expect(
                    (await tasks.tasks()).filter((task) =>
                        task.taskName.startsWith("timeoutParticipant")
                    )
                ).to.deep.equal([]);
                expect(
                    await h.control(spectator).query.getStatus().request()
                ).to.equal(Status.SYNCED);
            } finally {
                await tasks.restore();
            }
        });
    });
});
