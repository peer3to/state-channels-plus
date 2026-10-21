import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncRequest } from "@/rpc/network/services/spectate/SpectateService";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import {
    appendForgedInboundSuccessor,
    applyDisputeWindowInboundSyncPayload,
    forgeWindowConfirmationSignatures,
    forgeWindowReductionInputs,
    recoverWindowDisputesAfterSyncPastFork,
    redirectDisputesToChannelWithoutWindow,
    redirectDisputesToForkWithoutWindow
} from "@test/fixtures/DisputeWindowInboundSyncStaging";
import {
    applyAnchoredSyncPayload,
    forgedOutboundBlock,
    stageAnchoredSyncPayload
} from "@test/fixtures/HistoricSyncStaging";
import { applySyncFromChainAheadResponder } from "@test/fixtures/LaggingChainViewSyncStaging";
import {
    applyDisputedSyncPayload,
    applySyncPayload,
    applySyncPayloadServedBeforeAdoption,
    assertConcurrentSyncWindowOverwrite,
    assertConcurrentPinnedRequests,
    assertBatchedSyncFinality,
    assertComputedSuccessorSync,
    assertFailedSyncInstallPersistsNothing,
    assertPinnedHeight,
    assertQueuedSuccessorBlockSurvivesSyncInstall,
    assertSyncWindowReadRace,
    openSelfRemovalDispute,
    reduceWindowOnChain
} from "@test/fixtures/PinnedSyncStaging";
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
        await assertComputedSuccessorSync(TestSession.getHarness(), false);
    });
    it("successor sync succeeds before its genesis is installed without either blacklist", async function () {
        await assertComputedSuccessorSync(TestSession.getHarness(), true);
    });
    it("a successor sync whose install read fails after the VM write → throws, the VM is restored, nothing of the payload is stored, the fork stays", async function () {
        await assertFailedSyncInstallPersistsNothing(TestSession.getHarness());
    });
    it("a successor block's queue timeout running while the sync install is held → the fork is unknown, not known stale: the block is probed, then stored on the successor", async function () {
        await assertQueuedSuccessorBlockSurvivesSyncInstall(
            TestSession.getHarness()
        );
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
                return sm.p2pManager.localRpc.spectateService
                    .applySyncResponse(
                        source,
                        {
                            ...request,
                            blockHeight:
                                sm.storage.blocks.getNextBlockHeight(
                                    sm.forkId
                                ) + 1
                        },
                        response.encodedSyncPayload
                    )
                    .then(({ synced }) => synced);
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

        it("a last-milestone block whose bytes do not decode → milestones invalid, the sync does not throw", async function () {
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
            const served = await h
                .control(responder)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            expect(served).to.not.equal(null);
            // the walk checks the latest block of every tier's start, so its
            // junk bytes make the proof invalid
            const payload = Codec.decode(
                served!.encodedSyncPayload,
                Type.SyncPayload
            );
            const lastRun =
                payload.stateProof.milestones.at(-1)!.blockConfirmations;
            lastRun.at(-1)!.signedBlock.encodedBlock = ethers.id(
                "bytes that do not decode as a block"
            );

            const stub = h.control(requester).stub;
            await stub.recordSyncRejections().request();
            try {
                const accepted = await h
                    .control(requester)
                    .spectate.applySyncResponse(
                        responder.address,
                        forkId,
                        latestHeight!,
                        Codec.encode(payload, Type.SyncPayload) as string
                    )
                    .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
                expect(accepted).to.equal(false);
                expect(
                    await stub.restoreRecordedSyncRejections().request()
                ).to.deep.equal(["milestones invalid"]);
            } finally {
                await stub.restoreRecordedSyncRejections().request();
            }
        });
    });

    describe("historic verification", function () {
        it("on-chain snapshot ahead of the payload genesis on the same fork → milestones and the latest-fork outbound run verified from it, accepted", async function () {
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

    describe("chain view behind the server's", function () {
        it("requester's provider behind the responder's after a snapshot post → the sync waits until its chain head reaches the payload's chain block, then verifies from the moved anchor and accepts; responder kept", async function () {
            const r = await applySyncFromChainAheadResponder(
                TestSession.getHarness(),
                { release: "duringWait" }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.responderBlacklisted).to.equal(false);
            expect(r.connected).to.equal(true);
            expect(r.requesterSnapshotHash).to.equal(r.chainSnapshotHash);
        });

        it("requester's provider stays behind the payload's chain block for one agreement window → not synced with no verdict: no rejection, responder neither blacklisted nor cut", async function () {
            const r = await applySyncFromChainAheadResponder(
                TestSession.getHarness(),
                { release: "never" }
            );
            expect(r.accepted).to.equal(false);
            expect(r.rejections).to.deep.equal([]);
            expect(r.responderBlacklisted).to.equal(false);
            expect(r.connected).to.equal(true);
        });

        it("requester's sync service stops while it waits for its chain head → not synced at once with no verdict, before the agreement window ends", async function () {
            const r = await applySyncFromChainAheadResponder(
                TestSession.getHarness(),
                { release: "dispose" }
            );
            expect(r.accepted).to.equal(false);
            expect(r.rejections).to.deep.equal([]);
            expect(r.responderBlacklisted).to.equal(false);
            expect(r.waitEndedMs).to.be.lessThan(r.agreementTimeMs / 2);
        });
    });

    describe("historic verification persistence", function () {
        it("a milestone prepended wholly below the on-chain anchor carrying a snapshot above it → sync accepted, neither its block nor the snapshot is stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload } =
                await stageAnchoredSyncPayload(h);
            const anchor = onChainSnapshot.blockHeight;
            const milestones = payload.stateProof.milestones;
            const first = milestones[0].blockConfirmations[0];
            const firstHeight = Block.fromBlockConfirmation(first).height;
            // the honest proof starts above the anchor; the prepended milestone
            // ends below it, so the walk skips it without any check
            expect(firstHeight).to.be.greaterThan(anchor);
            const below = Codec.decode(
                first.signedBlock.encodedBlock,
                Type.Block
            );
            below.transaction.header.transactionCnt = BigInt(anchor - 1);
            below.transaction.header.timestamp =
                BigInt(below.transaction.header.timestamp) + 2n;
            const planted = {
                signedBlock: {
                    encodedBlock: Codec.encode(below, Type.Block) as string,
                    signature: first.signedBlock.signature
                },
                signatures: first.signatures
            };
            milestones.unshift({ blockConfirmations: [planted] });
            const plantedSnapshot = {
                ...payload.milestoneSnapshots[0],
                timestamp: BigInt(payload.milestoneSnapshots[0].timestamp) + 1n
            };
            payload.milestoneSnapshots.unshift(plantedSnapshot);
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
                        belowAnchor: Array.from(
                            { length: a.anchor },
                            (_, height) => height
                        ).filter(
                            (height) =>
                                !!sm.storage.blocks.getBlock(a.forkId, height)
                        ),
                        firstVerifiedBlockHash:
                            sm.storage.blocks.getBlock(a.forkId, a.firstHeight)
                                ?.hash ?? null,
                        plantedStored: !!sm.storage.blocks.getBlock(
                            a.plantedHash
                        ),
                        plantedSnapshotStored:
                            !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                                a.plantedSnapshotHash
                            )
                    }),
                    {
                        forkId,
                        anchor,
                        firstHeight,
                        plantedHash: Block.fromBlockConfirmation(planted).hash,
                        plantedSnapshotHash:
                            StateSnapshot.from(plantedSnapshot).hash
                    }
                );
                expect(stored).to.deep.equal({
                    belowAnchor: [],
                    firstVerifiedBlockHash:
                        Block.fromBlockConfirmation(first).hash,
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

    describe("historic verification rejections", function () {
        it("milestone snapshot at the requester's own finalized point altered → accepted from that point, the altered snapshot is not stored", async function () {
            const h = TestSession.getHarness();
            let alteredHash = "";
            const { accepted, rejections } = await applyAnchoredSyncPayload(
                h,
                (payload) => {
                    const last = payload.milestoneSnapshots.at(-1)!;
                    last.timestamp = BigInt(last.timestamp) + 1n;
                    alteredHash = String(StateSnapshot.from(last).hash);
                }
            );
            // the requester already holds the last milestone's final point:
            // its walk starts there and never reads the supplied snapshot
            expect(accepted).to.equal(true);
            expect(rejections).to.deep.equal([]);
            expect(
                await h.execOnHost(
                    h.getPeer(2),
                    (sm, a) =>
                        !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                            a.alteredHash
                        ),
                    { alteredHash }
                ),
                "altered snapshot stored"
            ).to.equal(false);
        });

        it("every milestone below the on-chain anchor with a forged newer snapshot → rejected, milestones invalid", async function () {
            const h = TestSession.getHarness();
            let forgedHash = "";
            const { accepted, rejections } = await applyAnchoredSyncPayload(
                h,
                (payload, onChainSnapshot) => {
                    const first =
                        payload.stateProof.milestones[0].blockConfirmations[0];
                    const block = Codec.decode(
                        first.signedBlock.encodedBlock,
                        Type.Block
                    );
                    block.transaction.header.transactionCnt = BigInt(
                        onChainSnapshot.blockHeight - 1
                    );
                    // no participant signed this snapshot; only the skipped milestone stands behind it
                    const forged = payload.milestoneSnapshots.at(-1)!;
                    forged.timestamp = BigInt(forged.timestamp) + 1n;
                    payload.milestoneSnapshots = [forged];
                    forgedHash = String(StateSnapshot.from(forged).hash);
                    const encodedBelow = Codec.encode(
                        block,
                        Type.Block
                    ) as string;
                    // an unsigned block at the proved height, linked to the first; the anchor height is skipped
                    const top = Codec.decode(encodedBelow, Type.Block);
                    top.transaction.header.transactionCnt = BigInt(
                        forged.blockHeight
                    );
                    top.previousBlockHash = ethers.keccak256(encodedBelow);
                    top.stateSnapshotHash = StateSnapshot.from(forged).hash;
                    payload.stateProof.milestones = [
                        {
                            blockConfirmations: [
                                encodedBelow,
                                Codec.encode(top, Type.Block) as string
                            ].map((encodedBlock) => ({
                                signedBlock: {
                                    encodedBlock,
                                    signature: first.signedBlock.signature
                                },
                                signatures: []
                            }))
                        }
                    ];
                }
            );
            // the forged snapshot was never installed as the requester's state
            expect(
                await h.execOnHost(
                    h.getPeer(2),
                    (sm, a) =>
                        !!sm.storage.stateSnapshots.getStateSnapshotByHash(
                            a.forgedHash
                        ),
                    { forgedHash }
                ),
                "forged snapshot installed"
            ).to.equal(false);
            expect(accepted).to.equal(false);
            expect(rejections).to.deep.equal(["milestones invalid"]);
        });

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

    describe("dispute window not yet reduced", function () {
        it("served window still in its kill period → not accepted, no verdict naming the window, responder not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            await openSelfRemovalDispute(h);
            const {
                payload,
                accepted,
                unsettledForkId,
                rejections,
                responderBlacklisted
            } = await applySyncPayload(h, {});
            // premise: the payload carries the open window
            expect(
                payload.disputeWindows.map((window) => window.forkId)
            ).to.deep.equal([forkId]);
            expect((await h.query.killPeriod(forkId, 2)).isExpired).to.equal(
                false
            );
            expect(accepted).to.equal(false);
            // no verdict names the window the chain has not reduced
            expect(unsettledForkId).to.equal(forkId);
            expect(rejections).to.deep.equal([]);
            expect(responderBlacklisted).to.equal(false);
        });

        it("served window in its kill period the requester has not applied → not accepted, no verdict naming the window, responder not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            // peer 2 never applies DisputeCommitted -> only the sync's own
            // chain fetch can give its local diamond the window
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                2,
                { passFirst: false }
            );
            try {
                await openSelfRemovalDispute(h, [0]);
                const {
                    payload,
                    accepted,
                    unsettledForkId,
                    rejections,
                    responderBlacklisted
                } = await applySyncPayload(h, {
                    afterServe: async () => {
                        // premise: the requester's local diamond lacks the window
                        expect(
                            await h
                                .control(h.getPeer(2))
                                .query.getDisputeWindowCommitments(forkId)
                                .request()
                        ).to.deep.equal([]);
                    }
                });
                // premise: the payload carries the open window
                expect(
                    payload.disputeWindows.map((window) => window.forkId)
                ).to.deep.equal([forkId]);
                expect(
                    (await h.query.killPeriod(forkId, 2)).isExpired
                ).to.equal(false);
                expect(accepted).to.equal(false);
                // no verdict names the window the chain has not reduced
                expect(unsettledForkId).to.equal(forkId);
                expect(rejections).to.deep.equal([]);
                expect(responderBlacklisted).to.equal(false);
            } finally {
                await restoreEvents(false);
            }
        });

        it("served window the chain does not hold → rejected, dispute window not on chain", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const {
                accepted,
                unsettledForkId,
                rejections,
                responderBlacklisted
            } = await applySyncPayload(h, {
                // a window for the undisputed on-chain fork
                mutate: (payload) => {
                    payload.disputeWindows.push({
                        disputeConfirmations: [],
                        forkId,
                        latestStateSnapshot: payload.latestForkGenesisSnapshot,
                        latestEncodedStateMachineState:
                            payload.latestForkGenesisEncodedState,
                        inboundMessageBlocksAppliedInReduce: [],
                        reducedForkId: ethers.hexlify(ethers.randomBytes(32))
                    });
                }
            });
            // premise: the chain holds no window for the served fork
            expect((await h.query.killPeriod(forkId, 2)).windowExists).to.equal(
                false
            );
            expect(accepted).to.equal(false);
            expect(unsettledForkId).to.equal(undefined);
            expect(rejections).to.deep.equal(["dispute window not on chain"]);
            expect(responderBlacklisted).to.equal(true);
        });

        it("dispute opens on the latest fork after the payload was served → not accepted, no verdict naming the window, responder not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const {
                payload,
                accepted,
                unsettledForkId,
                rejections,
                responderBlacklisted
            } = await applySyncPayload(h, {
                afterServe: () => openSelfRemovalDispute(h)
            });
            // premise: the latest fork was undisputed when the payload was
            // served, and its window is in its kill period when applied
            expect(payload.disputeWindows).to.deep.equal([]);
            const killPeriod = await h.query.killPeriod(forkId, 2);
            expect(killPeriod.windowExists).to.equal(true);
            expect(killPeriod.isExpired).to.equal(false);
            expect(accepted).to.equal(false);
            // no verdict names the window the chain has not reduced
            expect(unsettledForkId).to.equal(forkId);
            expect(rejections).to.deep.equal([]);
            expect(responderBlacklisted).to.equal(false);
        });

        it("payload older than the latest fork's reduction, its reduced window missing → rejected, latest fork is disputed", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            // the chain reduces the window but no peer adopts the successor
            for (const peer of h.peers) {
                await h.rpcStub.holdReductionRace(peer.index);
            }
            const {
                accepted,
                unsettledForkId,
                rejections,
                responderBlacklisted
            } = await applySyncPayload(h, {
                afterServe: async () => {
                    await openSelfRemovalDispute(h);
                    await waitFor(
                        async () =>
                            (await h.query.killPeriod(forkId, 2)).isExpired,
                        h.event.protocolEventTimeoutMs()
                    );
                    await reduceWindowOnChain(h, 0, forkId);
                }
            });
            expect(accepted).to.equal(false);
            expect(unsettledForkId).to.equal(undefined);
            expect(rejections).to.deep.equal(["latest fork is disputed"]);
            expect(responderBlacklisted).to.equal(true);
        });

        it("dispute opens on the latest fork after the payload was served, its kill period over but the chain has not reduced it → not accepted, no verdict naming the window, responder not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            // the window stays unreduced on chain after its kill period
            for (const peer of h.peers) {
                await h.rpcStub.holdReductionRace(peer.index);
            }
            const {
                accepted,
                unsettledForkId,
                rejections,
                responderBlacklisted
            } = await applySyncPayload(h, {
                afterServe: async () => {
                    await openSelfRemovalDispute(h);
                    await waitFor(
                        async () =>
                            (await h.query.killPeriod(forkId, 2)).isExpired,
                        h.event.protocolEventTimeoutMs()
                    );
                }
            });
            // premise: still unreduced on chain after the apply
            expect(await h.query.reducedForkOnChain(forkId)).to.equal(
                ethers.ZeroHash
            );
            expect(accepted).to.equal(false);
            expect(unsettledForkId).to.equal(forkId);
            expect(rejections).to.deep.equal([]);
            expect(responderBlacklisted).to.equal(false);
        });
    });

    describe("dispute window not yet reduced: chain judgement and wait", function () {
        // reduceAndFinalize makes a window final at once: the chain holds a
        // reduced, non-final window only between the sync's finality read and
        // its window fetch
        it("the chain reduces the served window between the finality read and the window fetch, the payload claiming another successor → local reduction reverts on the reduced window, rejected, served reduction reverts", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "chainAfterFinalityRead",
                    mutate: (payload) => {
                        payload.disputeWindows[0].reducedForkId =
                            ethers.hexlify(ethers.randomBytes(32));
                    }
                }
            );
            expect(r.accepted).to.equal(false);
            expect(r.unsettledForkId).to.equal(undefined);
            expect(r.rejections).to.deep.equal(["served reduction reverts"]);
            expect(r.responderBlacklisted).to.equal(true);
        });

        it("the chain reduces the window after the sync read it but before the sync waits → the wait ends on its chain read, the same peer is asked again and the sync succeeds", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const requester = h.control(h.getPeer(2));
            const responder = h.getPeer(0);
            await h
                .control(responder)
                .stub.stubCountSpectateRequests()
                .request();
            await openSelfRemovalDispute(h);
            // the applied outcome is held before the sync acts on it
            await requester.stub
                .stubHoldSpectateSyncApplication(responder.address, false, true)
                .request();
            const syncing = h.execOnHost(
                h.getPeer(2),
                (sm, { source }) =>
                    sm.p2pManager.localRpc.spectateService.sync(
                        source,
                        sm.channelId
                    ),
                { source: responder.address },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            await waitFor(
                async () =>
                    (await requester.stub
                        .getHeldSpectateSyncApplicationCount()
                        .request()) === 1
            );
            // the reduction event lands while nothing listens for it
            await waitFor(
                async () => (await h.query.killPeriod(forkId, 2)).isExpired,
                h.event.protocolEventTimeoutMs() * 2
            );
            await reduceWindowOnChain(h, 0, forkId);
            // premise: the requester handled the reduction event before
            // the sync starts to wait, so only the wait's own chain read can
            // see it
            await h.event.waitForPeers(
                "onDisputeReducedResultCommitted",
                [2],
                1,
                { mode: "atLeast" }
            );
            await requester.stub.restoreHoldSpectateSyncApplication().request();
            expect(await syncing).to.equal(true);
            expect(
                await h
                    .control(responder)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(2);
            const reducedForkId = await h.query.reducedForkOnChain(forkId);
            await waitFor(
                async () =>
                    (await requester.query.getForkId().request()) ===
                    reducedForkId
            );
            expect(
                await requester.query.isBlacklisted(responder.address).request()
            ).to.equal(false);
        });

        it("the wait's chain read fails → the sync rejects with the read's error, the responder is neither blacklisted nor asked again, stop resolves", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const requester = h.control(h.getPeer(2));
            const responder = h.getPeer(0);
            await h
                .control(responder)
                .stub.stubCountSpectateRequests()
                .request();
            await openSelfRemovalDispute(h);
            // the requester's next reduced-result read is the wait's own
            await requester.stub
                .stubFailChainReads("getReducedResult", 1)
                .request();
            try {
                await expect(
                    h.execOnHost(
                        h.getPeer(2),
                        (sm, { source }) =>
                            sm.p2pManager.localRpc.spectateService.sync(
                                source,
                                sm.channelId
                            ),
                        { source: responder.address }
                    )
                ).to.be.rejectedWith(
                    "stubbed chain read failure: getReducedResult"
                );
                expect(
                    await requester.stub.getChainReadObservation().request()
                ).to.deep.equal({ failed: 1, passed: 0 });
            } finally {
                await requester.stub.restoreChainReadFailures().request();
            }
            expect(
                await h
                    .control(responder)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(1);
            expect(
                await requester.query.isBlacklisted(responder.address).request()
            ).to.equal(false);
            expect(
                await h.execOnHost(h.getPeer(2), async (sm) => {
                    await sm.stop();
                    return sm.isDisposed;
                })
            ).to.equal(true);
        });

        it("the service is disposed after the sync applied its answer but before it waits → the sync returns false without waiting, the responder is asked once and not blacklisted", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const requester = h.control(h.getPeer(2));
            const responder = h.getPeer(0);
            await h
                .control(responder)
                .stub.stubCountSpectateRequests()
                .request();
            await openSelfRemovalDispute(h);
            // the applied outcome names the unreduced window and is held
            // before the sync acts on it
            await requester.stub
                .stubHoldSpectateSyncApplication(responder.address, false, true)
                .request();
            const syncing = h.execOnHost(
                h.getPeer(2),
                (sm, { source }) =>
                    sm.p2pManager.localRpc.spectateService.sync(
                        source,
                        sm.channelId
                    ),
                { source: responder.address },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            await waitFor(
                async () =>
                    (await requester.stub
                        .getHeldSpectateSyncApplicationCount()
                        .request()) === 1
            );
            await h.execOnHost(h.getPeer(2), (sm) => {
                sm.p2pManager.localRpc.spectateService.dispose();
            });
            await requester.stub.restoreHoldSpectateSyncApplication().request();
            expect(await syncing).to.equal(false);
            expect(await h.query.reducedForkOnChain(forkId)).to.equal(
                ethers.ZeroHash
            );
            expect(
                await h
                    .control(responder)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(1);
            expect(
                await requester.query.isBlacklisted(responder.address).request()
            ).to.equal(false);
        });

        it("reductions of another window and of another channel while the sync waits → ignored: the responder is asked again only after the chain reduces the served window", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            const requester = h.control(h.getPeer(2));
            const responder = h.getPeer(0);
            await h
                .control(responder)
                .stub.stubCountSpectateRequests()
                .request();
            await openSelfRemovalDispute(h);
            const syncing = h.execOnHost(
                h.getPeer(2),
                (sm, { source }) =>
                    sm.p2pManager.localRpc.spectateService.sync(
                        source,
                        sm.channelId
                    ),
                { source: responder.address },
                { timeoutMs: h.event.hostExecTimeoutMs() }
            );
            // well after the first answer the sync is waiting
            await waitFor(
                async () =>
                    (await h
                        .control(responder)
                        .stub.getSpectateRequestCount()
                        .request()) === 1
            );
            await waitFor(
                async () => (await h.query.killPeriod(forkId, 2)).isExpired,
                h.event.protocolEventTimeoutMs() * 2
            );
            // the requester's bus reports the reduction of another fork's
            // window, then of this fork's window in another channel
            await h.execOnHost(
                h.getPeer(2),
                (sm, { forkId, otherId }) => {
                    for (const [channelId, reducedForkId] of [
                        [sm.channelId, otherId],
                        [otherId, forkId]
                    ])
                        sm.events.emit(
                            "eventHandler",
                            "onDisputeReducedResultCommitted",
                            [channelId, reducedForkId]
                        );
                },
                { forkId, otherId: ethers.id("another window") }
            );
            expect(await h.query.reducedForkOnChain(forkId)).to.equal(
                ethers.ZeroHash
            );
            expect(
                await h
                    .control(responder)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(1);
            await reduceWindowOnChain(h, 0, forkId);
            expect(await syncing).to.equal(true);
            expect(
                await h
                    .control(responder)
                    .stub.getSpectateRequestCount()
                    .request()
            ).to.equal(2);
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

        it("single dispute window starting at the on-chain fork → accepted", async function () {
            const { accepted, rejections } = await applyDisputedSyncPayload(
                TestSession.getHarness(),
                () => {}
            );
            expect(rejections).to.deep.equal([]);
            expect(accepted).to.equal(true);
        });

        it("chain-final unadopted window with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "chainBeforeSync",
                    mutate: appendForgedInboundSuccessor
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.appliedInboundHashes.length).to.equal(
                r.servedInboundHashes.length + 1
            );
            expect(r.storedInboundHashes).to.deep.equal([]);
            expect(r.inboundHeadAfter).to.equal(r.inboundHeadBefore);
        });

        it("window reduced locally during sync → accepted, its inbound blocks stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                { reduction: "local", mutate: () => {} }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.storedInboundHashes).to.deep.equal(r.servedInboundHashes);
            expect(r.inboundHeadAfter).to.equal(r.servedInboundHashes.at(-1));
        });

        // the same forged payload once the chain reduced the window is the
        // "reduction lands on chain ... fabricated inbound successor" cases
        it("window the chain has not reduced, reduced locally during sync with a fabricated inbound successor → local reduction reverts, no verdict naming the window, no window inbound block stored, inbound head unchanged", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                { reduction: "local", mutate: appendForgedInboundSuccessor }
            );
            expect(r.accepted).to.equal(false);
            expect(r.unsettledForkId).to.equal(r.sourceForkId);
            expect(r.rejections).to.deep.equal([]);
            expect(r.responderBlacklisted).to.equal(false);
            expect(r.appliedInboundHashes.length).to.equal(
                r.servedInboundHashes.length + 1
            );
            expect(r.storedInboundHashes).to.deep.equal([]);
            expect(r.inboundHeadAfter).to.equal(r.inboundHeadBefore);
            expect(r.localReducedForkId).to.equal(ethers.ZeroHash);
        });

        it("unreduced window whose disputes name a fork without a window, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "local",
                    mutate: redirectDisputesToForkWithoutWindow
                }
            );
            expect(r.accepted).to.equal(false);
            expect(r.rejections).to.deep.equal(["dispute window mismatch"]);
            expect(r.responderBlacklisted).to.equal(true);
            expect(r.requesterForkId).to.equal(r.sourceForkId);
            expect(r.localReducedForkId).to.equal(ethers.ZeroHash);
            expect(r.storedInboundHashes).to.deep.equal([]);
            expect(r.inboundHeadAfter).to.equal(r.inboundHeadBefore);
        });

        it("unreduced window whose disputes name the window's fork under another channel, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "local",
                    mutate: redirectDisputesToChannelWithoutWindow
                }
            );
            expect(r.accepted).to.equal(false);
            expect(r.rejections).to.deep.equal(["dispute window mismatch"]);
            expect(r.responderBlacklisted).to.equal(true);
            expect(r.requesterForkId).to.equal(r.sourceForkId);
            expect(r.localReducedForkId).to.equal(ethers.ZeroHash);
            expect(r.storedInboundHashes).to.deep.equal([]);
            expect(r.inboundHeadAfter).to.equal(r.inboundHeadBefore);
        });

        it("reduction lands on chain after the finality read and before the window fetch, with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "chainAfterFinalityRead",
                    mutate: appendForgedInboundSuccessor
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.appliedInboundHashes.length).to.equal(
                r.servedInboundHashes.length + 1
            );
            expect(r.storedInboundHashes).to.deep.equal([]);
            expect(r.inboundHeadAfter).to.equal(r.inboundHeadBefore);
        });

        it("window already reduced locally by a concurrent sync, with a fabricated inbound successor → accepted, only the concurrent sync's genuine inbound blocks stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "concurrentLocalSync",
                    mutate: appendForgedInboundSuccessor
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.appliedInboundHashes.length).to.equal(
                r.servedInboundHashes.length + 1
            );
            expect(r.storedInboundHashes).to.deep.equal(r.servedInboundHashes);
            expect(r.inboundHeadAfter).to.equal(r.servedInboundHashes.at(-1));
        });

        it("window reduced locally during sync, with forged confirmation signatures → accepted, no forged signature stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "local",
                    mutate: forgeWindowConfirmationSignatures
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            // only a window this sync reduced stores its inbound blocks
            expect(r.storedInboundHashes).to.deep.equal(r.servedInboundHashes);
            expect(r.unservedSignatures.length).to.be.greaterThan(0);
            expect(r.storedUnservedSignatures).to.deep.equal([]);
        });

        it("chain-final unadopted window with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "chainBeforeSync",
                    mutate: forgeWindowReductionInputs
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.unservedSignatures.length).to.be.greaterThan(0);
            expect(r.storedUnservedSignatures).to.deep.equal([]);
            expect(r.storedUnservedDisputeHashes).to.deep.equal([]);
            expect(r.appliedWindowSnapshotHash).to.not.equal(
                r.servedWindowSnapshotHash
            );
            expect(r.appliedWindowSnapshotStored).to.equal(false);
        });

        it("reduction lands on chain after the finality read and before the window fetch, with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "chainAfterFinalityRead",
                    mutate: forgeWindowReductionInputs
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.unservedSignatures.length).to.be.greaterThan(0);
            expect(r.storedUnservedSignatures).to.deep.equal([]);
            expect(r.storedUnservedDisputeHashes).to.deep.equal([]);
            expect(r.appliedWindowSnapshotHash).to.not.equal(
                r.servedWindowSnapshotHash
            );
            expect(r.appliedWindowSnapshotStored).to.equal(false);
        });

        it("window already reduced locally by a concurrent sync, with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored", async function () {
            const r = await applyDisputeWindowInboundSyncPayload(
                TestSession.getHarness(),
                {
                    reduction: "concurrentLocalSync",
                    mutate: forgeWindowReductionInputs
                }
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.unservedSignatures.length).to.be.greaterThan(0);
            expect(r.storedUnservedSignatures).to.deep.equal([]);
            expect(r.storedUnservedDisputeHashes).to.deep.equal([]);
            expect(r.appliedWindowSnapshotHash).to.not.equal(
                r.servedWindowSnapshotHash
            );
            expect(r.appliedWindowSnapshotStored).to.equal(false);
        });

        it("chain-final unadopted window synced by a requester that handled none of its dispute logs → the sync stores no confirmation, and the requester, now on the reduced fork, recovers every window dispute from chain logs without auditing", async function () {
            const r = await recoverWindowDisputesAfterSyncPastFork(
                TestSession.getHarness()
            );
            expect(r.rejections).to.deep.equal([]);
            expect(r.accepted).to.equal(true);
            expect(r.disputeLogsHandledDuringSync).to.equal(0);
            expect(r.requesterForkId).to.equal(r.reducedForkId);
            expect(r.storedServedDisputeHashesAfterSync).to.deep.equal([]);
            expect(r.recoveredCommitments).to.not.equal(null);
            expect(
                r.recoveredCommitments!.map((commitment) =>
                    commitment.toLowerCase()
                )
            ).to.have.members(
                r.servedDisputeHashes.map((disputeHash) =>
                    String(disputeHash).toLowerCase()
                )
            );
            expect(r.heldDisputeHashes).to.have.members(r.servedDisputeHashes);
            expect(r.auditReads).to.equal(0);
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
            // the dispute recovery inside generateSyncPayload is the only
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
            await restoreEvents(false);
        });

        // no test: "reduce data unavailable -> refuse to serve" needs the
        // responder's local diamond inbound head above its inbound storage
        // (computeReductionLocally takes the reduced inbound head from the
        // mirror, getReduceData walks storage) while it still holds every
        // dispute of the window. `rpcStub.holdInboundMessageStorage` produces
        // the split, but every dispute of the window names that inbound head,
        // so a participant responder's own audit fails on the same missing run
        // before it stores the dispute: its window read refuses first
        // ("dispute window unavailable", the case below). A spectator persists
        // disputes without auditing; staging one that follows the disputed
        // window with a held inbound write is not in the harness yet. The
        // undefined outcome itself is pinned by
        // "Unit: AgreementManager ... unrecoverable reduce run -> undefined".
        it.skip("reduce data unavailable for a disputed window → payload refused (needs a mirror ahead of storage)", function () {});

        // the sibling gap that IS stageable: the window's own disputes are
        // on-chain but unreadable locally. we must not serve a proof we could
        // not build - and must not throw either, which is what the old
        // "Disputes unavailable after event recovery" did
        it("dispute window unavailable → payload refused, no throw", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2,
                    passFirst: true
                });

            // blinded recovery: the missing dispute can never be recovered
            const blinded = await h.rpcStub.hideChainLogs(observerIndex);
            let threw = "";
            let syncResult: unknown = "unset";
            try {
                syncResult = await h
                    .control(h.getPeer(observerIndex))
                    .spectate.generateSyncPayload(h.channelId!, forkId, 0)
                    .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }
            await blinded.restore();

            expect(
                threw,
                "generateSyncPayload must refuse, not throw"
            ).to.equal("");
            expect(
                syncResult,
                "a window we cannot read must not be served as a proof"
            ).to.be.null;
            expect(
                await h
                    .control(h.getPeer(observerIndex))
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([]);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
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
            await restoreEvents(false);
        });
    });
});
