import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import type { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import { ethers } from "ethers";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import { waitFor } from "@test/utils/waitFor";

describe("Unit: SpectateService", function () {
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
        it("the same-fork target snapshot lands before validation → accepts the proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0);
            const forkId = h.activeForkId!;
            const participantIndices = [0, 1, 2, 3];

            const requester = await h.join.addSpectatorWait();
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
                .request();
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
                .request();
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

    describe("tryMulticallSnapshotUpdate", function () {
        it("the exact target snapshot lands first → accepts the benign height race", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;
            const source = h.getPeer(0);
            const staleOnChainSnapshot =
                await h.channelManager.getStateSnapshot(h.channelId);
            const latestHeight = await h
                .control(source)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(latestHeight).to.not.equal(null);
            const payload = await h
                .control(source)
                .spectate.generateSyncPayload(
                    h.channelId,
                    forkId,
                    latestHeight!
                )
                .request();
            expect(payload).to.not.equal(null);

            const postedSnapshot = await h.transition.postSnapshotWait({
                peerIndex: source.index,
                forkId: String(forkId)
            });
            expect(postedSnapshot).to.not.equal(undefined);
            const currentOnChainSnapshot = StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            );
            expect(currentOnChainSnapshot.hash).to.equal(postedSnapshot!.hash);

            await h
                .control(source)
                .stub.stubNextReductionSimulationError(
                    "RaceConditionBlockHeightTooOld"
                )
                .request();
            const accepted = await h
                .control(source)
                .spectate.tryMulticallSnapshotUpdate(
                    StateSnapshot.from(staleOnChainSnapshot).encode() as string,
                    payload!.encodedSyncPayload
                )
                .request();
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
                    .request();
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
            await restoreEvents(false);
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
            const blinded = await h.rpcStub.failChainLogQueries(observerIndex);
            let threw = "";
            let syncResult: unknown = "unset";
            try {
                syncResult = await h
                    .control(h.getPeer(observerIndex))
                    .spectate.generateSyncPayload(h.channelId!, forkId, 0)
                    .request();
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
        it("all dispute events suppressed → still declines the disputed fork instead of proving it", async function () {
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
                .request();

            // reading the flag from the chain makes the walk enter the window,
            // recover it, reduce past this fork, and find it is not the tip it
            // can prove -> decline. reading it from the local mirror would skip
            // the loop and hand back a payload proving the disputed fork.
            expect(
                syncResult,
                "a fork the chain says is disputed must never be proved as the tip"
            ).to.be.null;

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });
    });
});
