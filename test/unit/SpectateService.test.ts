import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncRequest } from "@/rpc/network/services/spectate/SpectateService";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import {
    applyAnchoredSyncPayload,
    applyCasesAsParticipant,
    applyOnCutParticipant,
    applyInOrderOnFreshRequester,
    applyOnFreshRequester,
    forgedOutboundBlock,
    forgeGenesisTimestamp,
    forgeSyncPayloads,
    forgeUnbackedDepositBlockZero,
    freshSpectatorStopsOnPayload,
    prependMilestoneAt,
    stageAnchoredSyncPayload,
    stageBlockZeroPayload,
    stageConflictingFinalRunPayload,
    stageForgedUnfinalTailPayload,
    syncAcrossForgedParticipantChange,
    syncSpectatorAboveQueuedBlocks
} from "@test/fixtures/HistoricSyncStaging";
import {
    applyChainFinalWindowWithForgedGenesis,
    applyChainFinalWindowWithForgedInbound,
    applyDisputedSyncPayload,
    applyDisputedSyncPayloadWithFailingReduction,
    applySyncPayloadServedBeforeAdoption,
    assertConcurrentSyncWindowOverwrite,
    assertConcurrentPinnedRequests,
    assertBatchedSyncFinality,
    assertComputedSuccessorSync,
    assertPinnedHeight,
    assertSyncWindowReadRace,
    generateAtMalformedHeights,
    participantSyncOutlivesRoundTrip,
    requestLatestFrom,
    requestLatestFromChainFinalSpectator,
    requestLatestFromStaleSpectator,
    requestLatestFromUninstalledResponder
} from "@test/fixtures/PinnedSyncStaging";
import {
    constructProof,
    postSnapshotAt,
    stageUnsignedGenesisTip
} from "@test/fixtures/StateProofConstructionStaging";
import {
    prependForgedHeightMilestone,
    proofHeights,
    servedPayload,
    stageAnchoredHistory,
    stageForgedBlockBelowAnchorInRun,
    stageMergedSignaturePayload,
    stageRepeatedTailPayloads,
    stageSeparatedEvidencePayload,
    stageServedRunPayload,
    storedBlocks,
    syncOnFreshRequester,
    syncSpectatorOnServedPayload
} from "@test/fixtures/SyncCompletionStaging";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("Unit: SpectateService", function () {
    it("concurrent identical sync requests share the completed result", async () => {
        await assertConcurrentPinnedRequests(TestSession.getHarness(), "same");
    });
    it("a higher in-flight sync satisfies a lower requested height", async () => {
        await assertConcurrentPinnedRequests(TestSession.getHarness(), "lower");
    });
    it("a higher requested height waits then runs its own pinned sync", async () => {
        await assertConcurrentPinnedRequests(
            TestSession.getHarness(),
            "higher"
        );
    });
    it("concurrent sync callers both receive a completed proof failure", async () => {
        await assertConcurrentPinnedRequests(
            TestSession.getHarness(),
            "failure"
        );
    });

    it("concurrent source syncs accept when a second persist overwrites the first reduction", async function () {
        await assertConcurrentSyncWindowOverwrite(TestSession.getHarness());
    });
    it("sync batches finality reads for two supplied windows before rejection", async function () {
        await assertBatchedSyncFinality(TestSession.getHarness());
    });
    it("old-fork sync succeeds while successor installation is held without either blacklist", async function () {
        await assertComputedSuccessorSync(TestSession.getHarness(), "source");
    });
    it("successor sync succeeds before its genesis is installed without either blacklist", async function () {
        await assertComputedSuccessorSync(
            TestSession.getHarness(),
            "successor"
        );
    });
    it("latest request to a responder whose own fork is behind the derived fork → served from the derived fork", async function () {
        await assertComputedSuccessorSync(TestSession.getHarness(), "latest");
    });
    it("pinned sync serves the exact current height", async function () {
        await assertPinnedHeight(TestSession.getHarness(), 0);
    });
    it("pinned sync serves a newer proof than the requested height", async function () {
        await assertPinnedHeight(TestSession.getHarness(), -1);
    });
    it("pinned sync refuses a height above the available proof", async function () {
        await assertPinnedHeight(TestSession.getHarness(), 1);
    });
    it("pinned sync rejects a valid proof below the requested minimum", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
        const accepted = await h.execOnHost(
            h.getPeer(2),
            async (sm, { source }) => {
                const request = { channelId: sm.channelId, forkId: sm.forkId };
                const response = await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest(request)
                    .request(source);
                return sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    source,
                    {
                        ...request,
                        blockHeight:
                            sm.storage.blocks.getNextBlockHeight(sm.forkId) + 1
                    },
                    response.encodedSyncPayload
                );
            },
            { source: h.getPeer(0).address }
        );
        expect(accepted).to.equal(false);
    });
    it("concurrent proof application does not mistake local reduction for chain finality", async function () {
        await assertSyncWindowReadRace(TestSession.getHarness(), false);
    });
    it("sync accepts a reduction landing after its chain window was persisted", async function () {
        await assertSyncWindowReadRace(TestSession.getHarness(), true);
    });
    it("plain pinned sync accepts a proved successor of the requested fork", async function () {
        const h = TestSession.getHarness();
        const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
        const source = h.getPeer(0);
        const observer = h.getPeer(2);
        const submit = await h.rpcStub.holdReductionAttempt(
            source.index,
            "submit"
        );
        try {
            await h.control(source).stub.startTryReduce(sourceForkId).request();
            await waitFor(async () => (await submit.entered()) === 1);
            const successor = await h
                .control(source)
                .query.getForkId()
                .request();
            expect(successor).not.to.equal(sourceForkId);
            const accepted = await h.execOnHost(
                observer,
                async (sm, args) =>
                    sm.p2pManager.localRpc.spectateService.sync(
                        args.source,
                        sm.channelId,
                        args.forkId,
                        0
                    ),
                { source: source.address, forkId: sourceForkId }
            );
            expect(accepted).to.equal(true);
            expect(
                await h.control(observer).query.getForkId().request()
            ).to.equal(successor);
            expect(
                await h
                    .control(observer)
                    .query.isBlacklisted(source.address)
                    .request()
            ).to.equal(false);
        } finally {
            await submit.release();
        }
    });
    it("plain pinned sync refuses an unknown fork", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const observer = h.getPeer(2);
        const source = h.getPeer(0);
        const before = h.activeForkId!;
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    args.forkId,
                    0
                ),
            { source: source.address, forkId: ethers.id("unknown-pinned-fork") }
        );
        expect(accepted).to.equal(false);
        expect(await h.control(observer).query.getForkId().request()).to.equal(
            before
        );
    });
    describe("sync request policy", function () {
        const channelId = ethers.id("spectate-policy-channel");
        const initial: SyncRequest = { channelId };
        const recovery: SyncRequest = {
            channelId,
            forkId: ethers.id("spectate-policy-fork"),
            blockHeight: 7
        };

        it("one sync request supports initial load and exact recovery", function () {
            expect(initial).to.deep.equal({ channelId });
            expect(recovery).to.include({ blockHeight: 7 });
            expect(recovery.forkId).to.equal(ethers.id("spectate-policy-fork"));
            expect(initial).not.to.have.any.keys("timeoutMs", "sentAt");
        });

        it("exact recovery failure preserves a synced observer runtime", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const responder = h.getPeer(0);
            const restore = await h.rpcStub.stubSpectateJunkPayload([
                responder.index
            ]);
            try {
                await h
                    .control(prepared.joiner)
                    .spectate.startSync(
                        responder.address,
                        prepared.expectedForkId,
                        0
                    )
                    .request();
                await waitFor(
                    () =>
                        h
                            .control(prepared.joiner)
                            .query.isBlacklisted(responder.address)
                            .request(),
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await h.control(prepared.joiner).query.getStatus().request()
                ).to.equal(Status.SYNCED);
                expect(
                    await new TargetedChannelJoinFixture(h).isDisposed(
                        prepared.joiner
                    )
                ).to.equal(false);
            } finally {
                await restore();
            }
        });
    });

    describe("applySyncResponse", function () {
        // verification is historic: a dispute landing after the proof was served does not change what it proves
        it("a dispute opens on the pinned fork after the proof was served → accepted, responder neither rejected nor blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const responder = h.getPeer(0);
            const requester = h.getPeer(2);

            const latestHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(latestHeight).to.not.equal(null);
            const payload = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            expect(payload).to.not.equal(null);
            const decodedPayload = Codec.decode(
                payload!.encodedSyncPayload,
                Type.SyncPayload
            );
            // the proof advances the fork, and the fork was undisputed when
            // the proof was served
            expect(decodedPayload.milestoneSnapshots.length).to.be.greaterThan(
                0
            );
            expect(decodedPayload.disputeWindows).to.deep.equal([]);

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.stateProof.milestones = [];
            });
            const killPeriod = await h.query.killPeriod(
                forkId,
                requester.index
            );
            expect(killPeriod.windowExists).to.equal(true);
            expect(killPeriod.isExpired).to.equal(false);

            const stub = h.control(requester).stub;
            await stub.recordSyncRejections().request();
            try {
                const accepted = await h
                    .control(requester)
                    .spectate.applySyncResponse(
                        responder.address,
                        forkId,
                        latestHeight!,
                        payload!.encodedSyncPayload
                    )
                    .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
                expect(accepted).to.equal(true);
                expect(
                    await stub.restoreRecordedSyncRejections().request()
                ).to.deep.equal([]);
                expect(
                    await h
                        .control(requester)
                        .query.isBlacklisted(responder.address)
                        .request()
                ).to.equal(false);
            } finally {
                await stub.restoreRecordedSyncRejections().request();
            }

            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("the same-fork target snapshot lands before validation → accepts the proof", async function () {
            const h = TestSession.getHarness();
            // Create the requester before genesis starts the block-zero deadline.
            // It must precede every block without spending that deadline on worker startup.
            await h.setup(5);
            const participantIndices = [0, 1, 2, 3];
            const forkId =
                await h.lifecycle.openChannelForParticipants(
                    participantIndices
                );
            const requester = h.getPeer(4);
            await h.network.blacklistAndDisconnectPeer(requester.index);
            for (const peerIndex of participantIndices) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubPostStateSnapshot()
                    .request();
            }

            await h.transition.advanceState({
                count: 2,
                waitForPeers: participantIndices,
                waitForFinalization: true
            });
            const leaverIndex =
                await h.transition.participantLeaveStateTransition({
                    waitForPeers: participantIndices,
                    waitForFinalization: true
                });
            const responder = h.getPeer(
                participantIndices.find((index) => index !== leaverIndex)!
            );
            const latestHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(latestHeight).to.not.equal(null);

            const payload = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            expect(payload).to.not.equal(null);
            const decodedPayload = Codec.decode(
                payload!.encodedSyncPayload,
                Type.SyncPayload
            );
            expect(
                decodedPayload.outboundMessageBlocksOfTheLatestFork.length
            ).to.be.greaterThan(0);

            await h
                .control(responder)
                .stub.restorePostStateSnapshot()
                .request();
            const postedSnapshot = await h.transition.postSnapshotWait({
                peerIndex: responder.index,
                forkId: String(forkId)
            });
            expect(postedSnapshot).to.not.equal(undefined);
            expect(postedSnapshot!.blockHeight).to.equal(latestHeight);
            const payloadAfterSnapshot = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            expect(payloadAfterSnapshot).to.not.equal(null);
            expect(
                Codec.decode(
                    payloadAfterSnapshot!.encodedSyncPayload,
                    Type.SyncPayload
                ).outboundMessageBlocksUpToLatestGenesis
            ).to.deep.equal([]);

            await h
                .control(requester)
                .spectate.applySyncResponse(
                    responder.address,
                    forkId,
                    latestHeight!,
                    payload!.encodedSyncPayload
                )
                .request();
            expect(
                await h.control(requester).query.getStatus().request()
            ).to.equal(Status.SYNCED);
        });
    });

    describe("historic verification", function () {
        it("on-chain snapshot ahead of the payload genesis on the same fork → milestones and outbound verified from it, accepted", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;
            const responder = h.getPeer(0);
            const requester = h.getPeer(2);
            const posted = await h.transition.postSnapshotWait({
                peerIndex: responder.index,
                forkId: String(forkId)
            });
            expect(posted).to.not.equal(undefined);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const latestHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(latestHeight).to.not.equal(null);
            // the chain sits strictly between the fork genesis and the proven target
            const onChainSnapshot = StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            );
            expect(onChainSnapshot.forkID).to.equal(forkId);
            expect(onChainSnapshot.blockHeight).to.be.greaterThan(0);
            expect(onChainSnapshot.blockHeight).to.be.lessThan(latestHeight!);

            const payload = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            expect(payload).to.not.equal(null);

            const stub = h.control(requester).stub;
            await stub.recordSyncRejections().request();
            try {
                const accepted = await h
                    .control(requester)
                    .spectate.applySyncResponse(
                        responder.address,
                        forkId,
                        latestHeight!,
                        payload!.encodedSyncPayload
                    )
                    .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
                expect(accepted).to.equal(true);
                expect(
                    await stub.restoreRecordedSyncRejections().request()
                ).to.deep.equal([]);
            } finally {
                await stub.restoreRecordedSyncRejections().request();
            }
        });
    });

    describe("verified sync persistence", function () {
        it("unverified proof does not authorize support insertion", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload } =
                await stageAnchoredSyncPayload(h);
            // a milestone wholly below the start: the walk drops it unchecked
            const { planted, plantedSnapshot } = prependMilestoneAt(
                payload,
                onChainSnapshot.blockHeight - 1
            );
            const encodedSyncPayload = Codec.encode(
                payload,
                Type.SyncPayload
            ) as string;
            const servers = h.peers.slice();
            for (const peer of servers)
                await h
                    .control(peer)
                    .stub.stubSpectatePayload(encodedSyncPayload)
                    .request();
            try {
                const spectator = await h.join.addSpectatorWait();
                const stored = await h.execOnHost(
                    h.getPeer(spectator.index),
                    (sm, a) => ({
                        plantedStored:
                            sm.storage.blocks.getBlock(a.forkId, a.height)
                                ?.hash === a.plantedHash,
                        plantedSnapshotStored:
                            !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                                a.plantedSnapshotHash
                            )
                    }),
                    {
                        forkId,
                        height: onChainSnapshot.blockHeight - 1,
                        plantedHash: Block.fromBlockConfirmation(planted).hash,
                        plantedSnapshotHash:
                            StateSnapshot.from(plantedSnapshot).hash
                    }
                );
                expect(stored).to.deep.equal({
                    plantedStored: false,
                    plantedSnapshotStored: false
                });
            } finally {
                for (const peer of servers)
                    await h
                        .control(peer)
                        .stub.restoreSpectateStaleProof()
                        .request();
            }
        });
    });

    describe("queued blocks below the installed sync", function () {
        it("a spectator whose sync installs above blocks still in its queue → those blocks are dropped: no abort, no participant cut, it keeps following", async function () {
            const h = TestSession.getHarness();
            const { spectator, forkId, queuedHash } =
                await syncSpectatorAboveQueuedBlocks(h);
            const query = h.control(spectator).query;
            await waitFor(
                async () => !(await query.isBlockQueued(queuedHash).request()),
                h.event.protocolEventTimeoutMs()
            );
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1],
                waitForFinalization: true
            });
            const head = await h
                .control(h.getPeer(0))
                .query.getLatestBlockHash(forkId)
                .request();
            await waitFor(
                async () =>
                    (await query.getLatestBlockHash(forkId).request()) === head,
                h.event.protocolEventTimeoutMs()
            );
            expect(await query.getStatus().request()).to.equal(Status.SYNCED);
            for (const index of [0, 1])
                expect(
                    await query
                        .isBlacklisted(h.getPeer(index).address)
                        .request()
                ).to.equal(false);
        });
    });

    describe("historic verification rejections", function () {
        it("outbound block above the on-chain anchor forged → rejected, latest-fork outbound blocks invalid", async function () {
            const { accepted, rejections } = await applyAnchoredSyncPayload(
                TestSession.getHarness(),
                (payload) => {
                    payload.outboundMessageBlocksOfTheLatestFork.push(
                        forgedOutboundBlock(payload)
                    );
                }
            );
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal([
                "latest-fork outbound blocks invalid"
            ]);
        });
    });

    // a fresh requester: no local history or final point of its own
    describe("sync verification and completion", function () {
        it("requester accepts threshold advance", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            expect(
                await applyOnFreshRequester(h, String(forkId), payload)
            ).to.deep.include({
                accepted: true,
                rejections: [],
                blacklisted: false,
                latestHeight
            });
        });

        it("requester rejects forged adopted snapshot", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageAnchoredSyncPayload(h);
            const last = payload.milestoneSnapshots.at(-1)!;
            last.timestamp = BigInt(last.timestamp) + 1n;
            expect(
                await applyOnFreshRequester(h, String(forkId), payload, {
                    snapshotHash: String(StateSnapshot.from(last).hash)
                })
            ).to.deep.include({
                accepted: false,
                rejections: ["milestones invalid"],
                blacklisted: true,
                storedSnapshot: false
            });
        });

        it("proof below sync anchor blacklists the responder", async function () {
            const h = TestSession.getHarness();
            const { forkId, responder, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            // the chain anchor moves above everything the payload serves
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const posted = await h.transition.postSnapshotWait({
                peerIndex: responder.index,
                forkId: String(forkId)
            });
            expect(posted!.blockHeight).to.be.greaterThan(latestHeight);
            expect(
                await applyOnFreshRequester(h, String(forkId), payload)
            ).to.deep.include({
                accepted: false,
                rejections: ["served state below the proof start"],
                blacklisted: true
            });
        });

        it("local walk failure throws without blacklisting the responder", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageAnchoredSyncPayload(h);
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                payload,
                { faultLocalWalk: true }
            );
            expect(outcome.threw).to.contain("Malformed RPC request");
            expect(outcome).to.deep.include({
                rejections: [],
                blacklisted: false
            });
        });

        it("sync forged unfinal zero rejects without adoption", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageBlockZeroPayload(h);
            // without its threshold signatures block 0 is unfinal: the
            // served block-0 state does not reach the final point (genesis)
            payload.stateProof.milestones[0].blockConfirmations[0].signatures =
                [];
            expect(
                await applyOnFreshRequester(h, forkId, payload, {
                    snapshotHash: String(
                        StateSnapshot.from(payload.milestoneSnapshots[0]).hash
                    )
                })
            ).to.deep.include({ accepted: false, storedSnapshot: false });
        });

        it("requester accepts empty genesis", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            // block 0 is due from the genesis on: no timeout dispute meanwhile
            for (const index of [0, 1, 2])
                await h.rpcStub.suppressTimeoutCheck(index);
            const forkId = String(h.activeForkId!);
            const outcome = await syncOnFreshRequester(h, forkId, ["served"]);
            // no block yet: the served proof is empty and proves the genesis
            expect(outcome.served!.stateProof.milestones).to.deep.equal([]);
            expect(outcome.served!.milestoneSnapshots).to.deep.equal([]);
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: -1,
                installedStateHash: String(
                    StateSnapshot.from(
                        outcome.served!.latestForkGenesisSnapshot
                    ).stateMachineStateHash
                )
            });
        });

        it("requester accepts start-only proof", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, payload } = await stageAnchoredHistory(h, {
                blocksAfter: 0
            });
            // the one run holds the anchor: nothing proven above the start
            expect(proofHeights(payload)).to.deep.equal([[anchor.blockHeight]]);
            expect(
                await syncOnFreshRequester(h, forkId, [payload])
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: anchor.blockHeight
            });
        });

        it("requester accepts start plus unfinal run", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, {
                    blocksAfter: 2,
                    cutPeer: true
                });
            // the run holding the anchor carries the unfinal blocks above it
            const a = anchor.blockHeight;
            expect(proofHeights(payload)).to.deep.equal([[a, a + 1, a + 2]]);
            expect(
                StateSnapshot.from(payload.milestoneSnapshots[0]).hash
            ).to.equal(anchor.hash);
            expect(
                await syncOnFreshRequester(h, forkId, [payload])
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight
            });
        });

        it("requester ignores unused placeholder", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            // a milestone wholly below the start: the walk drops it unchecked
            const placeholderHeight = onChainSnapshot.blockHeight - 1;
            const { plantedSnapshot } = prependMilestoneAt(
                payload,
                placeholderHeight
            );
            expect(
                await syncOnFreshRequester(h, String(forkId), [payload], {
                    inspect: {
                        heights: [placeholderHeight],
                        snapshotHashes: [
                            String(StateSnapshot.from(plantedSnapshot).hash)
                        ]
                    }
                })
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight,
                blocks: [null],
                snapshotsStored: [false]
            });
        });

        it("requester uses shared tier fallback", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            // no local final point: tier one is skipped, the local diamond
            // decides and the chain is never walked
            const fresh = await syncOnFreshRequester(
                h,
                String(forkId),
                [payload],
                { observeWalks: true }
            );
            expect(fresh).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight
            });
            expect(fresh.walks!.trustedStart.local.reads).to.equal(0);
            expect(fresh.walks!.storage.local).to.deep.include({
                reads: 1,
                answers: [true]
            });
            expect(fresh.walks!.storage.chain.reads).to.equal(0);

            // a running participant walks from its own final point first
            const trustedStart = await h.mirror.observe(
                2,
                "verifyMilestonesFromTrustedStart"
            );
            const storage = await h.mirror.observe(2, "verifyMilestones");
            const participant = await applyCasesAsParticipant(h, 2, 0, [
                {
                    encodedSyncPayload: Codec.encode(
                        payload,
                        Type.SyncPayload
                    ) as string,
                    forkId: String(forkId),
                    blockHeight: latestHeight
                }
            ]);
            expect(participant).to.deep.include({
                verdicts: [true],
                rejections: [],
                blacklisted: false
            });
            expect((await trustedStart.observation()).local.answers).to.include(
                true
            );
            const storageWalks = await storage.observation();
            expect(storageWalks.local.reads).to.equal(0);
            expect(storageWalks.chain.reads).to.equal(0);
        });

        it("matching persisted state at sync anchor completes sync", async function () {
            const h = TestSession.getHarness();
            const { forkId, responder, anchor, payload } =
                await stageAnchoredHistory(h, { blocksAfter: 0 });
            const a = anchor.blockHeight;
            const served = await storedBlocks(h, responder, forkId, [a]);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [a],
                    snapshotHashes: [String(anchor.hash)],
                    stateHashes: [String(anchor.stateMachineStateHash)]
                },
                reconstruct: true
            });
            // the anchor's own state, snapshot and block are what completes
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                head: a,
                installedStateHash: String(anchor.stateMachineStateHash),
                blocks: served,
                snapshotsStored: [true],
                statesStored: [true]
            });
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: a,
                milestones: [[a]]
            });
        });

        it("verified served tail above sync anchor persists through tip", async function () {
            const h = TestSession.getHarness();
            const { forkId, responder, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, {
                    blocksAfter: 2,
                    cutPeer: true
                });
            const a = anchor.blockHeight;
            const heights = [a, a + 1, a + 2];
            const served = await storedBlocks(h, responder, forkId, heights);
            const tipStateHash = await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: { heights },
                reconstruct: true
            });
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight,
                installedStateHash: tipStateHash
            });
            // the replayed tail is stored as served, through the tip
            expect(outcome.blocks.map((block) => block?.hash)).to.deep.equal(
                served.map((block) => block?.hash)
            );
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: a,
                milestones: [heights]
            });
        });

        it("served state below a moved anchor is a stale proof: rejected and penalised", async function () {
            const h = TestSession.getHarness();
            // the run from the anchor through the tip, served with the
            // anchor's state
            const { forkId, anchor, latestHeight, payload } =
                await stageServedRunPayload(h, {
                    blocksAfter: 2,
                    first: 0,
                    last: 2
                });
            const a = anchor.blockHeight;
            // the chain anchor moves to the served tip, above the served state
            const tip = await postSnapshotAt(h, 0, latestHeight);
            expect(tip.blockHeight).to.be.greaterThan(a);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: { heights: [a, a + 1, a + 2] }
            });
            // nothing below the start is replayed or persisted
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: false, threw: "" }],
                rejections: ["served state below the proof start"],
                blacklisted: true,
                head: -1,
                blocks: [null, null, null]
            });
            expect(outcome.installedStateHash).to.not.equal(
                String(anchor.stateMachineStateHash)
            );
        });
    });

    describe("verified historical support", function () {
        it("compact sync reconstructs without gap history", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const firstHeight = proofHeights(payload)[0][0];
            const gap = Array.from(
                { length: firstHeight - onChainSnapshot.blockHeight },
                (_, offset) => onChainSnapshot.blockHeight + offset
            );
            expect(gap.length).to.be.greaterThan(0);
            const outcome = await syncOnFreshRequester(
                h,
                String(forkId),
                [payload],
                { inspect: { heights: gap }, reconstruct: true }
            );
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                head: latestHeight,
                blocks: gap.map(() => null)
            });
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: onChainSnapshot.blockHeight
            });
        });

        it("compact sync retains earlier multi-block signature evidence", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support, gapHeight } =
                await stageSeparatedEvidencePayload(h);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [first.height, support.height, gapHeight]
                },
                reconstruct: true
            });
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight
            });
            // the support block keeps the signature its predecessor's
            // threshold needs; the gap block is never fetched
            expect(outcome.blocks).to.deep.equal([
                first.block,
                support.block,
                null
            ]);
            expect(outcome.rebuilt!.chainValid).to.equal(true);
        });

        it("verified historical support persists without individual replay", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, support } =
                await stageSeparatedEvidencePayload(h);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [support.height],
                    snapshotHashes: [String(support.snapshot.hash)],
                    stateHashes: [
                        String(support.snapshot.stateMachineStateHash)
                    ]
                }
            });
            // stored at once; its transition never ran, so neither its
            // resulting snapshot nor its state exists
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                blocks: [support.block],
                snapshotsStored: [false],
                statesStored: [false]
            });
        });

        it("same-block signature merge preserves reconstruction", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, first, support, tail } =
                await stageMergedSignaturePayload(h);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [first.height, support.height, tail.height]
                },
                reconstruct: true
            });
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: tail.height
            });
            // both occurrences of the support block merged into one
            expect(outcome.blocks[0]).to.deep.equal(first.block);
            expect(outcome.blocks[1]).to.deep.equal(support.block);
            expect(outcome.blocks[2]?.hash).to.equal(tail.hash);
            expect(outcome.rebuilt!.chainValid).to.equal(true);
        });

        it("synced progress retains reconstruction", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support } =
                await stageSeparatedEvidencePayload(h);
            const spectator = await syncSpectatorOnServedPayload(h, payload);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const rebuilt = await constructProof(h, spectator.index);
            expect(rebuilt.chainValid).to.equal(true);
            expect(rebuilt.latestProofHeight).to.equal(latestHeight + 2);
            expect(
                await storedBlocks(h, spectator, forkId, [
                    first.height,
                    support.height
                ])
            ).to.deep.equal([first.block, support.block]);
        });

        it("later anchor makes old retained evidence irrelevant without pruning", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support } =
                await stageSeparatedEvidencePayload(h);
            const spectator = await syncSpectatorOnServedPayload(h, payload);
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const later = await postSnapshotAt(h, 0, latestHeight + 1);
            // the newer start needs none of the old evidence
            const rebuilt = await constructProof(h, spectator.index);
            expect(rebuilt).to.deep.include({
                chainValid: true,
                startHeight: later.blockHeight
            });
            expect(
                rebuilt.milestones
                    .flat()
                    .every((height) => height >= later.blockHeight)
            ).to.equal(true);
            // nothing is pruned
            expect(
                await storedBlocks(h, spectator, forkId, [
                    first.height,
                    support.height
                ])
            ).to.deep.equal([first.block, support.block]);
        });
    });

    describe("explicit sync retry", function () {
        it("restored provider permits explicit sync retry", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const encoded = Codec.encode(payload, Type.SyncPayload) as string;
            // the first apply meets the refused chain read; the retry
            // finds the provider answering again
            const { outcomes, rejections, blacklisted } =
                await applyInOrderOnFreshRequester(
                    h,
                    String(forkId),
                    [encoded, encoded],
                    { faultChainAnchor: true }
                );
            expect(outcomes[0].threw).to.contain("chain anchor read refused");
            expect(outcomes[0].latestHeight).to.equal(-1);
            expect(outcomes[1]).to.deep.include({
                accepted: true,
                threw: "",
                latestHeight
            });
            expect(rejections).to.deep.equal([]);
            expect(blacklisted).to.equal(false);
        });
    });

    // Verified persistence stores what the walk proves from its start: never
    // the replay tail, a dropped part, or a snapshot no stored block commits.
    describe("SpectateService verified proof persistence", function () {
        it("SpectateService verified proof persistence does not declare unfinal genesis state final", async function () {
            const h = TestSession.getHarness();
            // peer 2 is cut off before block 0: blocks 0 and 1 stay unfinal
            await stageUnsignedGenesisTip(h, 3, 2);
            const forkId = String(h.activeForkId!);
            const payload = await servedPayload(h, h.getPeer(0), forkId, 1);
            expect(proofHeights(payload)).to.deep.equal([[0, 1]]);
            const blockZeroSnapshot = StateSnapshot.from(
                payload.milestoneSnapshots[0]
            );
            // the replay stops at block 0: what persistence left is visible
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                failTailReplay: true,
                inspect: {
                    heights: [0, 1],
                    snapshotHashes: [String(blockZeroSnapshot.hash)]
                }
            });
            expect(outcome.outcomes[0].threw).to.contain(
                "Malformed RPC request"
            );
            expect(outcome).to.deep.include({
                rejections: [],
                blacklisted: false,
                blocks: [null, null],
                snapshotsStored: [false],
                installedStateHash: String(
                    StateSnapshot.from(payload.latestForkGenesisSnapshot)
                        .stateMachineStateHash
                )
            });
        });

        it("SpectateService last-tail blocks are absent from storage before their own replay", async function () {
            const h = TestSession.getHarness();
            const { forkId, responder, anchor, payload } =
                await stageAnchoredHistory(h, {
                    blocksAfter: 2,
                    cutPeer: true
                });
            const a = anchor.blockHeight;
            const [anchorBlock] = await storedBlocks(h, responder, forkId, [a]);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                failTailReplay: true,
                inspect: { heights: [a, a + 1, a + 2] }
            });
            expect(outcome.outcomes[0].threw).to.contain(
                "Malformed RPC request"
            );
            // the anchor block is history; the tail above it waits for replay
            expect(outcome).to.deep.include({
                rejections: [],
                blacklisted: false,
                blocks: [anchorBlock, null, null],
                installedStateHash: String(anchor.stateMachineStateHash)
            });
        });

        it("SpectateService anchor offset zero selects actual anchor", async function () {
            const h = TestSession.getHarness();
            // the run starts at the anchor; its supplied snapshot is forged
            const { forkId, anchor, payload, suppliedSnapshotHash } =
                await stageServedRunPayload(h, {
                    blocksAfter: 0,
                    first: 0,
                    last: 0,
                    forgeSnapshot: true
                });
            expect(
                await syncOnFreshRequester(h, forkId, [payload], {
                    inspect: {
                        snapshotHashes: [
                            String(anchor.hash),
                            suppliedSnapshotHash
                        ]
                    }
                })
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: anchor.blockHeight,
                installedStateHash: String(anchor.stateMachineStateHash),
                snapshotsStored: [true, false]
            });
        });

        it("SpectateService interior anchor selects actual anchor", async function () {
            const h = TestSession.getHarness();
            // the run starts one below the anchor and reaches the tip; its
            // supplied snapshot is forged
            const {
                forkId,
                responder,
                anchor,
                latestHeight,
                payload,
                suppliedSnapshotHash
            } = await stageServedRunPayload(h, {
                blocksAfter: 2,
                first: -1,
                last: 2,
                forgeSnapshot: true
            });
            const tipStateHash = await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            // replay from the anchor's state reaches the tip
            expect(
                await syncOnFreshRequester(h, forkId, [payload], {
                    inspect: {
                        snapshotHashes: [
                            String(anchor.hash),
                            suppliedSnapshotHash
                        ]
                    }
                })
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight,
                installedStateHash: tipStateHash,
                snapshotsStored: [true, false]
            });
        });

        it("SpectateService run holding the anchor stores no forged block below the anchor, its snapshot or its change point", async function () {
            const h = TestSession.getHarness();
            // the run anchor..tip led by a forged, unconfirmed block at
            // anchor-1 whose supplied snapshot drops a participant
            const { forkId, latestHeight, payload, forged } =
                await stageForgedBlockBelowAnchorInRun(h);
            const outcome = await syncOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [forged.height],
                    snapshotHashes: [forged.snapshotHash]
                }
            });
            // the walk proves the run from the anchor up: the sync completes
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight,
                blocks: [null],
                snapshotsStored: [false],
                changeHeights: []
            });
        });

        it("SpectateService all-dropped proof installs no supplied snapshot", async function () {
            const h = TestSession.getHarness();
            // one run wholly below the anchor, with the snapshot its block
            // commits
            const { forkId, anchor, payload, suppliedSnapshotHash } =
                await stageServedRunPayload(h, {
                    blocksAfter: 2,
                    first: -1,
                    last: -1
                });
            expect(
                await syncOnFreshRequester(h, forkId, [payload], {
                    inspect: {
                        heights: [anchor.blockHeight - 1],
                        snapshotHashes: [suppliedSnapshotHash]
                    }
                })
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                blocks: [null],
                snapshotsStored: [false],
                installedStateHash: String(anchor.stateMachineStateHash)
            });
        });

        it("SpectateService threshold snapshot is commitment-bound", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const committed = StateSnapshot.from(
                payload.milestoneSnapshots.at(-1)!
            );
            const forged = Codec.decode(
                Codec.encode(payload, Type.SyncPayload),
                Type.SyncPayload
            );
            const last = forged.milestoneSnapshots.at(-1)!;
            last.timestamp = BigInt(last.timestamp) + 1n;
            const outcome = await syncOnFreshRequester(
                h,
                String(forkId),
                [forged, payload],
                {
                    inspect: {
                        snapshotHashes: [
                            String(StateSnapshot.from(last).hash),
                            String(committed.hash)
                        ]
                    }
                }
            );
            // only the snapshot the threshold block commits is installed
            expect(outcome).to.deep.include({
                outcomes: [
                    { accepted: false, threw: "" },
                    { accepted: true, threw: "" }
                ],
                rejections: ["milestones invalid"],
                head: latestHeight,
                snapshotsStored: [false, true]
            });
        });

        it("SpectateService ignored forged height leaves snapshot maps unchanged", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const height = onChainSnapshot.blockHeight - 1;
            const forged = await prependForgedHeightMilestone(
                h,
                String(forkId),
                payload,
                height
            );
            expect(
                await syncOnFreshRequester(h, String(forkId), [payload], {
                    inspect: {
                        heights: [height],
                        snapshotHashes: [forged.snapshotHash]
                    }
                })
            ).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: latestHeight,
                blocks: [null],
                snapshotsStored: [false]
            });
        });
    });

    // The run [k, k+1, ...] occurs twice: as threshold support in the first
    // milestone and with the replay tail in the second. Identity keeps the
    // tail out of storage until its own replay, which runs its transition.
    describe("SpectateService repeated support and tail identity", function () {
        it("SpectateService repeated support and tail identity still executes bad transition", async function () {
            const h = TestSession.getHarness();
            const staged = await stageRepeatedTailPayloads(h);
            // a fresh requester whose replay stops at the first tail block:
            // the forged block's support occurrence stored nothing
            const fresh = await syncOnFreshRequester(
                h,
                staged.forkId,
                [staged.repeatedForged],
                {
                    failTailReplay: true,
                    inspect: { heights: [staged.forgedTail.height] }
                }
            );
            expect(fresh.outcomes[0].threw).to.contain("Malformed RPC request");
            expect(fresh).to.deep.include({
                rejections: [],
                blacklisted: false,
                blocks: [null]
            });
            // the cut-off participant replays it: the transition fails
            const { outcomes, rejections, blacklisted } =
                await applyOnCutParticipant(h, staged, [staged.repeatedForged]);
            expect(outcomes).to.deep.equal([{ accepted: false, threw: "" }]);
            expect(rejections).to.deep.equal(["block confirmation rejected"]);
            expect(blacklisted).to.equal(true);
            expect(
                await h
                    .control(h.getPeer(2))
                    .query.getBlockByHash(staged.forgedTail.hash)
                    .request()
            ).to.equal(null);
            await waitFor(
                async () =>
                    await h.channelManager.isForkDisputed(
                        h.channelId,
                        staged.forkId
                    ),
                h.event.protocolEventTimeoutMs()
            );
        });

        it("SpectateService repeated support and tail identity executes valid transition before storage", async function () {
            const h = TestSession.getHarness();
            const staged = await stageRepeatedTailPayloads(h);
            const outcome = await syncOnFreshRequester(
                h,
                staged.forkId,
                [staged.repeated],
                { inspect: { heights: staged.runHeights } }
            );
            expect(outcome).to.deep.include({
                outcomes: [{ accepted: true, threw: "" }],
                rejections: [],
                blacklisted: false,
                head: staged.runHeights.at(-1)!,
                blocks: staged.runBlocks
            });
        });
    });

    describe("tail replay failure", function () {
        it("cut-off participant: tail replay meeting an executor fault → the error propagates, nobody is cut; a re-signed invalid tail block → rejected, block confirmation rejected, responder blacklisted, the fork disputed", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedUnfinalTailPayload(h);
            const { outcomes, rejections, blacklisted } =
                await applyOnCutParticipant(
                    h,
                    staged,
                    [staged.payload, staged.forged],
                    0
                );
            expect(outcomes[0].threw).to.contain("Malformed RPC request");
            expect(outcomes[1]).to.deep.equal({ accepted: false, threw: "" });
            expect(rejections).to.deep.equal(["block confirmation rejected"]);
            expect(blacklisted).to.equal(true);
            await waitFor(
                async () =>
                    await h.channelManager.isForkDisputed(
                        h.channelId,
                        staged.forkId
                    ),
                h.event.protocolEventTimeoutMs()
            );
        });

        it("fresh spectator served a payload whose unfinal tail ends in a re-signed invalid block → its runtime stops entirely", async function () {
            const h = TestSession.getHarness();
            const { forged } = await stageForgedUnfinalTailPayload(h);
            expect(await freshSpectatorStopsOnPayload(h, forged)).to.equal(
                true
            );
        });
    });

    describe("persistence conflict", function () {
        it("cut-off participant served a threshold-final run whose first block conflicts with its stored block → rejected, payload persistence aborted, responder blacklisted, its stored history unchanged", async function () {
            const h = TestSession.getHarness();
            const staged = await stageConflictingFinalRunPayload(h);
            const query = h.control(h.getPeer(2)).query;
            const before = {
                atConflict: await query
                    .getBlockHashAt(staged.forkId, staged.conflictHeight)
                    .request(),
                next: await query.getNextBlockHeight(staged.forkId).request(),
                snapshot: await query
                    .getStateSnapshotHash(staged.forkId)
                    .request()
            };
            expect(before.next).to.equal(staged.conflictHeight + 1);
            const { outcomes, rejections, blacklisted } =
                await applyOnCutParticipant(h, staged, [staged.conflict]);
            expect(outcomes).to.deep.equal([{ accepted: false, threw: "" }]);
            expect(rejections).to.deep.equal(["payload persistence aborted"]);
            expect(blacklisted).to.equal(true);
            expect({
                atConflict: await query
                    .getBlockHashAt(staged.forkId, staged.conflictHeight)
                    .request(),
                next: await query.getNextBlockHeight(staged.forkId).request(),
                snapshot: await query
                    .getStateSnapshotHash(staged.forkId)
                    .request()
            }).to.deep.equal(before);
        });
    });

    describe("final points", function () {
        it("fresh spectator synced across two threshold-final milestones, the second dropping a participant → a final point per milestone and one participant-set change point at the second", async function () {
            const outcome = await syncAcrossForgedParticipantChange(
                TestSession.getHarness()
            );
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.accepted).to.equal(true);
            expect(outcome.firstStored).to.equal(true);
            expect(outcome.changedStored).to.equal(true);
            expect(outcome.changeHeights).to.deep.equal([outcome.changeHeight]);
            expect(outcome.changeHeight).to.equal(outcome.firstHeight + 1);
        });
    });

    describe("dispute window linkage", function () {
        it("first dispute window not on the on-chain fork → rejected, dispute window not linked", async function () {
            const { accepted, rejections } = await applyDisputedSyncPayload(
                TestSession.getHarness(),
                (payload) => {
                    // a real fork of this channel, but not the one the chain sits on
                    payload.disputeWindows[0].forkId =
                        payload.disputeWindows[0].reducedForkId;
                }
            );
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal(["dispute window not linked"]);
        });

        it("second dispute window not continuing from the first reduced fork → rejected, dispute window not linked", async function () {
            const { accepted, rejections } = await applyDisputedSyncPayload(
                TestSession.getHarness(),
                (payload) => {
                    // the repeat restarts at the source fork instead of its successor
                    payload.disputeWindows.push(payload.disputeWindows[0]);
                }
            );
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal(["dispute window not linked"]);
        });

        it("payload served before the chain adopted its window's reduced fork → prefix skipped, accepted, responder not blacklisted", async function () {
            const { accepted, rejections, responderBlacklisted } =
                await applySyncPayloadServedBeforeAdoption(
                    TestSession.getHarness(),
                    () => {}
                );
            expect(rejections).to.deep.equal([]);
            expect(accepted).to.equal(true);
            expect(responderBlacklisted).to.equal(false);
        });

        it("adopted prefix window claiming a reduced fork the chain did not record → rejected, dispute window not linked", async function () {
            const { accepted, rejections } =
                await applySyncPayloadServedBeforeAdoption(
                    TestSession.getHarness(),
                    (payload) => {
                        payload.disputeWindows[0].reducedForkId = ethers.id(
                            "not the recorded reduced fork"
                        );
                    }
                );
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal(["dispute window not linked"]);
        });

        it("chain-final window not yet adopted, its inbound input carrying a forged successor → accepted, the forged block is neither stored nor pending to sign", async function () {
            const h = TestSession.getHarness();
            const { accepted, rejections, forgedHash, reducedForkId } =
                await applyChainFinalWindowWithForgedInbound(h);
            expect(rejections).to.deep.equal([]);
            expect(accepted).to.equal(true);
            const query = h.control(h.getPeer(2)).query;
            expect(
                await query.getInboundMessageBlock(forgedHash).request()
            ).to.equal(null);
            expect(
                await query.getLatestInboundMessageHash().request()
            ).to.not.equal(forgedHash);
            expect(
                await query
                    .getPendingInboundMessageBlockCount(reducedForkId)
                    .request()
            ).to.equal(0);
        });

        it("chain-final window not yet adopted, its input snapshot a re-timed copy of the source fork genesis → accepted, the stored source genesis is unchanged and the copy is not stored", async function () {
            const h = TestSession.getHarness();
            const {
                accepted,
                rejections,
                realGenesisHash,
                forgedGenesisHash,
                storedGenesisHash
            } = await applyChainFinalWindowWithForgedGenesis(h);
            expect(rejections).to.deep.equal([]);
            expect(accepted).to.equal(true);
            expect(forgedGenesisHash).to.not.equal(realGenesisHash);
            expect(storedGenesisHash).to.equal(realGenesisHash);
            expect(
                await h
                    .control(h.getPeer(2))
                    .query.getStateSnapshotStructByHash(forgedGenesisHash)
                    .request()
            ).to.equal(null);
        });

        it("local window reduction failing at the executor connection → the error propagates, nobody is cut; reverting → rejected, dispute window reduction reverted, responder blacklisted", async function () {
            const { thrown, afterThrow, accepted, afterRevert } =
                await applyDisputedSyncPayloadWithFailingReduction(
                    TestSession.getHarness()
                );
            expect(thrown).to.contain("Malformed RPC request");
            expect(afterThrow).to.deep.equal({
                rejections: [],
                blacklisted: false
            });
            expect(accepted).to.equal(false);
            expect(afterRevert).to.deep.equal({
                rejections: ["dispute window reduction reverted"],
                blacklisted: true
            });
        });

        it("single dispute window starting at the on-chain fork → accepted", async function () {
            const { accepted, rejections } = await applyDisputedSyncPayload(
                TestSession.getHarness(),
                () => {}
            );
            expect(rejections).to.deep.equal([]);
            expect(accepted).to.equal(true);
        });
    });

    describe("generateSyncPayload", function () {
        // a dispute commitment can land on-chain before our
        // onDisputeCommitted handler stores the struct locally.
        // generateSyncPayload used to hit the throwing local lookup
        // directly and abort the sync; it now loads the window through the
        // same EventSyncService.loadSynchronizedWindowCommitments owner
        // reduction uses, which recovers first.
        it("committed dispute missing locally → recovers before generating the payload", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;

            // the observer's own dispute against the fault is created
            // locally (flips isForkDisputed regardless of event delivery),
            // but only the FIRST externally-arriving dispute event is let
            // through - a later honest disputer's commitment stays
            // genuinely missing from local storage
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2,
                    passFirst: true
                });

            const staged = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    const isDisputed =
                        await sm.diamondStateMachine.localDiamondContract.isForkDisputed(
                            sm.channelId,
                            args.forkId
                        );
                    // the on-chain window is what generateSyncPayload walks, so
                    // this is the list its recovery has to close
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const missingBefore = commitments.filter(
                        (c) => !sm.storage.disputes.getDispute(c)
                    );
                    return {
                        isDisputed,
                        commitmentCount: commitments.length,
                        missingBeforeCount: missingBefore.length
                    };
                },
                { forkId }
            );

            // sanity: the fork is genuinely disputed and a commitment of the
            // window the call walks is genuinely missing from local storage
            expect(
                staged.isDisputed,
                "observer must see the fork as disputed"
            ).to.equal(true);
            expect(
                staged.commitmentCount,
                "window must hold commitments"
            ).to.be.greaterThan(0);
            expect(
                staged.missingBeforeCount,
                "at least one commitment must be missing locally"
            ).to.be.greaterThan(0);

            // a window is served only once its kill period expired
            await h.assert.dispute.killPeriodExpiredWait(forkId, observerIndex);

            // RO1 turns a throw (missing dispute confirmation) into a
            // recovered read - a null/undefined return is a separate,
            // legitimate outcome (the requested fork isn't the tip derived
            // from the observer's own in-progress reduction), so the throw
            // is what this test pins, not the exact return value
            let threw = "";
            try {
                await h
                    .control(h.getPeer(observerIndex))
                    .spectate.generateSyncPayload(h.channelId!, forkId, 0)
                    .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }

            expect(
                threw,
                "generateSyncPayload must recover, not throw"
            ).to.equal("");

            const recovered = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const confirmations =
                        sm.agreementManager.getForkDisputeConfirmations(
                            commitments
                        );
                    return {
                        commitmentCount: commitments.length,
                        missingAfterCount: commitments.filter(
                            (c) => !sm.storage.disputes.getDispute(c)
                        ).length,
                        confirmationCount: confirmations.length
                    };
                },
                { forkId }
            );

            // the recovery really happened: every commitment of the window the
            // call walked is in storage afterwards. dispute events are still
            // held and the observer's own reduction is still frozen, so
            // ensureDisputesProcessed inside generateSyncPayload is the only
            // thing that could have stored them. without this the call could
            // return early before ever reaching the recovery and still pass.
            expect(
                recovered.commitmentCount,
                "the window must not shrink across the call"
            ).to.equal(staged.commitmentCount);
            expect(
                recovered.missingAfterCount,
                "generateSyncPayload must recover every missing dispute before reading confirmations"
            ).to.equal(0);

            expect(
                recovered.confirmationCount,
                "every on-chain commitment must resolve to a stored confirmation"
            ).to.equal(recovered.commitmentCount);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents();
        });

        // no test: "reduce data unavailable -> refuse to serve" needs the local
        // EVM mirror's inbound head to sit above what TS storage holds, because
        // computeReductionLocally takes the reduced inbound head from the mirror
        // (DisputeVerificationFacet.sol:109, channelBalances) while
        // getReduceData walks TS storage. No flow produces that split:
        // EventHandler.onInboundMessagesProcessed writes storage first and the
        // mirror second, so the mirror is never ahead. The one route that could
        // break the tie is onChannelStorageCleared, which moves the mirror's
        // inbound head without storing the block - it needs a real on-chain
        // clear to stage. The undefined outcome itself is pinned by
        // "Unit: AgreementManager ... unrecoverable reduce run -> undefined";
        // the responder then refuses exactly as for an unavailable window
        // (the case below).
        it.skip("reduce data unavailable for a disputed window → payload refused (needs a mirror ahead of storage)", function () {});

        // the sibling gap that IS stageable: the window's own disputes are
        // on-chain but unreadable locally. we must not serve a proof we could
        // not build - and the responder is not ready, the request is valid:
        // it refuses with an error reply and never excludes the requester
        it("latest request to a responder whose dispute window is unavailable → refused, requester not blacklisted", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2,
                    passFirst: true
                });
            const responder = h.getPeer(observerIndex);
            const requester = h.getPeer(1);

            // blinded recovery: the missing dispute can never be recovered
            const blinded = await h.rpcStub.failChainLogQueries(observerIndex);
            let refusal: string;
            try {
                ({ refusal } = await requestLatestFrom(
                    h,
                    requester,
                    responder.address
                ));
            } finally {
                await blinded.restore();
            }

            expect(refusal).to.equal(
                `Dispute window unavailable for fork ${forkId}`
            );
            expect(
                await h
                    .control(responder)
                    .query.isBlacklisted(requester.address)
                    .request()
            ).to.equal(false);
            expect(
                await h
                    .control(responder)
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([]);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents();
        });

        // the sibling above lets the first dispute event through, so the
        // responder's local EVM flips isForkDisputed on its own. with EVERY
        // dispute event held the local mirror still says "not disputed" while
        // the chain says it is - the walk has to take the disputed flag from
        // the same place it takes the window, or it skips the walk entirely
        // and proves a fork that is disputed and already reducible on-chain.
        it("all dispute events suppressed → recovers and proves the successor fork", async function () {
            // Host-side payload generation walks chain state and recovers
            // events; on a loaded farm that outlasts the default control RPC
            // budget, so every generateSyncPayload call here carries the
            // protocol timeout.
            const h = TestSession.getHarness();
            const observerIndex = 0;

            // nothing gets through - the observer never learns of any dispute
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2
                });

            const staged = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    // the local mirror is driven by the events we're holding
                    const localSaysDisputed =
                        await sm.diamondStateMachine.localDiamondContract.isForkDisputed(
                            sm.channelId,
                            args.forkId
                        );
                    // the chain is the truth the walk has to follow
                    const chainSaysDisputed =
                        await sm.stateChannelManagerContract.isForkDisputed(
                            sm.channelId,
                            args.forkId
                        );
                    return { localSaysDisputed, chainSaysDisputed };
                },
                { forkId }
            );

            // sanity: this test only means something while the two disagree
            expect(
                staged.chainSaysDisputed,
                "the chain must see the fork as disputed"
            ).to.equal(true);
            expect(
                staged.localSaysDisputed,
                "the local mirror must still be behind - otherwise the gate under test is never exercised"
            ).to.equal(false);

            // a window is served only once its kill period expired
            await h.assert.dispute.killPeriodExpiredWait(forkId, observerIndex);

            const syncResult = await h
                .control(h.getPeer(observerIndex))
                .spectate.generateSyncPayload(h.channelId!, forkId, 0)
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });

            // Chain recovery must prove the successor even while the mirror still lacks the events.
            expect(syncResult).to.not.be.null;
            expect(
                Codec.decode(syncResult!.encodedSyncPayload, Type.SyncPayload)
                    .latestForkGenesisSnapshot.forkId
            ).to.not.equal(forkId);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents();
        });

        it("latest request while the dispute window's kill period runs → refused, neither side blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 20 }
            });
            const forkId = h.activeForkId!;
            const responder = h.getPeer(0);
            const requester = h.getPeer(1);
            await h.byzantine.submitInvalidStateTransitionBlock(2);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [responder.index, requester.index]
            });

            const { refusal, synced } = await requestLatestFrom(
                h,
                requester,
                responder.address
            );

            expect(
                (await h.query.killPeriod(forkId, requester.index)).isExpired
            ).to.equal(false);
            expect(refusal).to.equal(
                `Kill period not expired for disputed fork ${forkId}`
            );
            expect(synced).to.equal(false);
            expect(
                await h
                    .control(requester)
                    .query.isBlacklisted(responder.address)
                    .request()
            ).to.equal(false);
            expect(
                await h
                    .control(responder)
                    .query.isBlacklisted(requester.address)
                    .request()
            ).to.equal(false);
        });
    });

    describe("verification failure consequences", function () {
        it("fresh requester rejects each forged element at its own step, then adopts and replays the valid payload without a transaction", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, onChainSnapshot, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const forged = forgeSyncPayloads(payload, onChainSnapshot, [
                "proofBlock",
                "genesis",
                "preGenesisOutbound",
                "finalizedState"
            ]);
            const outcome = await applyInOrderOnFreshRequester(
                h,
                String(forkId),
                [
                    forged.proofBlock,
                    forged.genesis,
                    forged.preGenesisOutbound,
                    forged.finalizedState,
                    Codec.encode(payload, Type.SyncPayload) as string
                ]
            );
            expect(outcome.rejections[0]).to.equal("proof block undecodable");
            expect(outcome.rejections[1]).to.equal("genesis snapshot invalid");
            expect(outcome.rejections[2]).to.equal(
                "pre-genesis outbound blocks invalid"
            );
            expect(outcome.rejections[3]).to.equal(
                "finalized state hash mismatch"
            );
            expect(outcome.rejections.length).to.equal(4);
            // no forged payload stored or replayed a block
            expect(outcome.outcomes[0].latestHeight).to.equal(-1);
            expect(outcome.outcomes[1].latestHeight).to.equal(-1);
            expect(outcome.outcomes[2].latestHeight).to.equal(-1);
            expect(outcome.outcomes[3].latestHeight).to.equal(-1);
            expect(outcome.blacklisted).to.equal(true);
            // the valid payload adopts and its unfinal suffix is replayed
            expect(outcome.outcomes[4].accepted).to.equal(true);
            expect(outcome.outcomes[4].latestHeight).to.equal(latestHeight);
            expect(outcome.noncesAfter).to.equal(outcome.noncesBefore);
        });

        it("running participant cuts the responder at each failed step and keeps participating with its state", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, onChainSnapshot, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const forged = forgeSyncPayloads(payload, onChainSnapshot, [
                "lineage",
                "genesis",
                "preGenesisOutbound"
            ]);
            const honest = Codec.encode(payload, Type.SyncPayload) as string;
            const fork = String(forkId);
            const result = await applyCasesAsParticipant(h, 2, 0, [
                {
                    encodedSyncPayload: forged.lineage,
                    forkId: fork,
                    blockHeight: null
                },
                {
                    encodedSyncPayload: forged.genesis,
                    forkId: fork,
                    blockHeight: null
                },
                {
                    encodedSyncPayload: forged.preGenesisOutbound,
                    forkId: fork,
                    blockHeight: null
                },
                // pinned to a fork the proof does not reach
                {
                    encodedSyncPayload: honest,
                    forkId: ethers.id("another fork"),
                    blockHeight: null
                },
                // pinned above the proved height
                {
                    encodedSyncPayload: honest,
                    forkId: fork,
                    blockHeight: latestHeight + 1
                }
            ]);
            expect(result.rejections[0]).to.equal("kill period not expired");
            expect(result.rejections[1]).to.equal("genesis snapshot invalid");
            expect(result.rejections[2]).to.equal(
                "pre-genesis outbound blocks invalid"
            );
            expect(result.rejections[3]).to.equal(
                "requested fork is not the latest"
            );
            expect(result.rejections[4]).to.equal(
                "proved height is below request"
            );
            expect(result.verdicts).to.deep.equal([
                false,
                false,
                false,
                false,
                false
            ]);
            expect(result.blacklisted).to.equal(true);
            expect(result.status).to.equal(Status.PARTICIPATING);
            expect(result.headAfter).to.equal(result.headBefore);
        });

        it("malformed requested heights are refused, the valid latest height is served", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2);
            expect(await generateAtMalformedHeights(h)).to.deep.equal({
                negative: false,
                fractional: false,
                unsafe: false,
                notANumber: false,
                latest: true
            });
        });

        it("latest request to a spectator whose stored head is below its posted proof start → refused, requester blacklisted", async function () {
            const {
                spectatorHead,
                postedHeight,
                refusal,
                requesterBlacklisted
            } = await requestLatestFromStaleSpectator(TestSession.getHarness());
            expect(spectatorHead).to.be.lessThan(postedHeight);
            expect(refusal).to.not.equal("");
            expect(requesterBlacklisted).to.equal(true);
        });

        it("latest request to a spectator that synced through a chain-final window → refused with an error reply each time, requester not blacklisted, spectator still synced", async function () {
            const {
                sourceForkId,
                firstRefusal,
                secondRefusal,
                requesterBlacklisted,
                spectatorStatus
            } = await requestLatestFromChainFinalSpectator(
                TestSession.getHarness()
            );
            expect(firstRefusal).to.equal(
                `Reduce data unavailable for disputed fork ${sourceForkId}`
            );
            expect(secondRefusal).to.equal(firstRefusal);
            expect(requesterBlacklisted).to.equal(false);
            expect(spectatorStatus).to.equal(Status.SYNCED);
        });

        it("latest request to a responder whose own state is not installed → refused for the derived fork, requester not blacklisted", async function () {
            const { forkId, refusal, synced, requesterBlacklisted } =
                await requestLatestFromUninstalledResponder(
                    TestSession.getHarness()
                );
            expect(refusal).to.equal(
                `No genesis snapshot found for fork ${forkId}`
            );
            expect(synced).to.equal(false);
            expect(requesterBlacklisted).to.equal(false);
        });

        it("participant sync that outlives its round-trip bound → false, one strike, no blacklist, still participating", async function () {
            const result = await participantSyncOutlivesRoundTrip(
                TestSession.getHarness()
            );
            expect(result.synced).to.equal(false);
            expect(result.strikes).to.equal(1);
            expect(result.blacklisted).to.equal(false);
            expect(result.status).to.equal(Status.PARTICIPATING);
        });

        it("genesis differing from the on-chain genesis only in its timestamp, served before the requester's first block → aborted, not persisted", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageBlockZeroPayload(h);
            const forgedHash = forgeGenesisTimestamp(payload);
            const outcome = await applyOnFreshRequester(h, forkId, payload, {
                snapshotHash: forgedHash
            });
            expect(outcome.accepted).to.equal(false);
            expect(outcome.rejections).to.deep.equal([
                "genesis snapshot invalid"
            ]);
            expect(outcome.storedSnapshot).to.equal(false);
        });

        it("successor-fork genesis differing from the reduction result only in its timestamp → aborted, not persisted", async function () {
            const h = TestSession.getHarness();
            let forgedHash = "";
            const { accepted, rejections } = await applyDisputedSyncPayload(
                h,
                (payload) => {
                    forgedHash = forgeGenesisTimestamp(payload);
                }
            );
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal(["genesis snapshot invalid"]);
            // the altered successor genesis is not stored
            expect(
                await h
                    .control(h.getPeer(2))
                    .query.getStateSnapshotStructByHash(forgedHash)
                    .request()
            ).to.equal(null);
        });

        it("chain anchor read failing on the requester → the error propagates, nobody is cut, nothing is stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const fresh = await applyOnFreshRequester(
                h,
                String(forkId),
                payload,
                { faultChainAnchor: true }
            );
            expect(fresh.threw).to.contain("chain anchor read refused");
            expect(fresh.rejections).to.deep.equal([]);
            expect(fresh.blacklisted).to.equal(false);
            expect(fresh.latestHeight).to.equal(-1);

            const participant = await applyCasesAsParticipant(h, 2, 0, [
                {
                    encodedSyncPayload: Codec.encode(
                        payload,
                        Type.SyncPayload
                    ) as string,
                    forkId: String(forkId),
                    blockHeight: latestHeight,
                    faultChainAnchor: true
                }
            ]);
            expect(String(participant.verdicts[0])).to.contain(
                "chain anchor read refused"
            );
            expect(participant.rejections).to.deep.equal([]);
            expect(participant.blacklisted).to.equal(false);
            expect(participant.status).to.equal(Status.PARTICIPATING);
            expect(participant.headAfter).to.equal(participant.headBefore);
        });

        it("latest-mode payload served before its fork was disputed → fresh requester rejects it, latest fork is disputed, nothing stored", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const responder = h.getPeer(0);
            const latestHeight = await h
                .control(responder)
                .query.getLatestBlockHeight(forkId)
                .request();
            const served = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            const { outcomes, rejections, blacklisted } =
                await applyInOrderOnFreshRequester(
                    h,
                    String(forkId),
                    [served!.encodedSyncPayload],
                    {
                        latest: true,
                        // the fork is disputed after the payload was served
                        beforeApply: async () => {
                            await h.tamper.postTamperedDispute(1, (dispute) => {
                                dispute.input.stateProof.milestones = [];
                            });
                            expect(
                                (await h.query.killPeriod(forkId, 1))
                                    .windowExists
                            ).to.equal(true);
                        }
                    }
                );
            expect(outcomes[0].accepted).to.equal(false);
            expect(rejections).to.deep.equal(["latest fork is disputed"]);
            expect(blacklisted).to.equal(true);
            expect(outcomes[0].latestHeight).to.equal(-1);
            // the released initial load meets the same disputed fork: it
            // fails and the spectator's uncommitted runtime is aborted
            await TestSession.expectFirstDetachedError({
                includes: "connectToChannel failed",
                timeoutMs: h.event.protocolEventTimeoutMs()
            });
            await TestSession.settleDetached({
                expectedErrorIncludes: "connectToChannel failed"
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [0, 1, 2]
            });
        });

        it("colluding participants sign a block-zero snapshot claiming unbacked deposits → fresh requester and running participant reject it, balance invariant failed, nothing stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageBlockZeroPayload(h);
            const forgedHash = await forgeUnbackedDepositBlockZero(h, payload);

            const fresh = await applyOnFreshRequester(h, forkId, payload, {
                snapshotHash: forgedHash
            });
            expect(fresh.accepted).to.equal(false);
            expect(fresh.rejections).to.deep.equal([
                "balance invariant failed"
            ]);
            expect(fresh.blacklisted).to.equal(true);
            expect(fresh.storedSnapshot).to.equal(false);
            expect(fresh.latestHeight).to.equal(-1);

            const participant = await applyCasesAsParticipant(h, 2, 0, [
                {
                    encodedSyncPayload: Codec.encode(
                        payload,
                        Type.SyncPayload
                    ) as string,
                    forkId,
                    blockHeight: null
                }
            ]);
            expect(participant.verdicts).to.deep.equal([false]);
            expect(participant.rejections).to.deep.equal([
                "balance invariant failed"
            ]);
            expect(participant.blacklisted).to.equal(true);
            expect(participant.status).to.equal(Status.PARTICIPATING);
            expect(participant.headAfter).to.equal(participant.headBefore);
            expect(
                await h
                    .control(h.getPeer(2))
                    .query.getStateSnapshotStructByHash(forgedHash)
                    .request()
            ).to.equal(null);
        });
    });
});
