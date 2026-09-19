import { hash as randomHash } from "../factory";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { Status } from "@/types";
import { sleep } from "@/utils";
import {
    assertSlashAdmission,
    assertSlashRefreshFailure
} from "@test/fixtures/QueueSlashFixture";
import {
    concurrentUnknownEligibility,
    missingInboundEligibility,
    eligibilityAppearsDuringRefresh,
    observeSourceEligibility,
    observeSlashDuringRefresh
} from "@test/fixtures/SourceEligibilityFixture";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

// membership is driven through the real signer entry points
// (p2pSigner.joinChannel / topUpBalance) and through a real leave.

describe("Unit: MembershipService", function () {
    it("an authoritative slash survives failed slash log recovery and repeated lookups", async () => {
        await assertSlashRefreshFailure();
    });
    it("unavailable inbound recovery leaves cached membership unchanged and does not blacklist the source", async () => {
        const observed = await missingInboundEligibility();
        expect(observed.before).to.deep.equal([
            SourceEligibility.ELIGIBLE,
            SourceEligibility.ELIGIBLE,
            SourceEligibility.ABSENT
        ]);
        expect(observed.after).to.deep.equal(observed.before);
        expect(observed.result).to.equal(SourceEligibility.ABSENT);
        expect(observed.reads.chainReads).to.equal(1);
        expect(observed.blacklisted).to.equal(false);
    });

    it("the storage-clear event clears chain, off-chain and slashed eligibility", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const local = ethers.Wallet.createRandom().address;
        const slashed = ethers.Wallet.createRandom().address;
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                sm.membershipService.publishOffChainEligibility([args.local]);
                sm.membershipService.observeOnChainSlash(args.slashed);
                const sources = [args.chain, args.local, args.slashed];
                const before = sources.map((source) =>
                    sm.membershipService.getCachedSourceEligibility(source)
                );
                const snapshot =
                    await sm.stateChannelManagerContract.getStateSnapshot(
                        sm.channelId
                    );
                await sm.eventHandler.onChannelStorageCleared(
                    sm.channelId,
                    snapshot.snapshotData.latestInboundMessageBlockHash,
                    { blockNumber: 0, logIndex: 0 }
                );
                return {
                    before,
                    after: sources.map((source) =>
                        sm.membershipService.getCachedSourceEligibility(source)
                    )
                };
            },
            { chain: h.getPeer(1).address, local, slashed }
        );
        expect(result.before).to.deep.equal([
            SourceEligibility.ELIGIBLE,
            SourceEligibility.ELIGIBLE,
            SourceEligibility.SLASHED
        ]);
        expect(result.after).to.deep.equal([
            SourceEligibility.ABSENT,
            SourceEligibility.ABSENT,
            SourceEligibility.ABSENT
        ]);
    });

    it("an unopened channel refresh has no eligible source and retains no old-channel positives", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                await sm.setChannelId(args.channelId);
                const ready =
                    await sm.membershipService.refreshOnChainEligibility();
                return {
                    ready,
                    source: sm.membershipService.getCachedSourceEligibility(
                        args.source
                    )
                };
            },
            { channelId: randomHash(), source: h.getPeer(1).address }
        );
        expect(result.ready).to.equal(true);
        expect(result.source).to.equal(SourceEligibility.ABSENT);
    });
    it("a slash observed during a held refresh cannot be undone by its older result", async () => {
        const observed = await observeSlashDuringRefresh();
        expect(observed.result).to.equal(true);
        expect(observed.reads).to.equal(1);
        expect(observed.state).to.equal(SourceEligibility.SLASHED);
    });
    it("a committed off-chain addition during refresh is eligible when the chain result misses it", async () => {
        const observed = await eligibilityAppearsDuringRefresh();
        expect(observed.result).to.equal(SourceEligibility.ELIGIBLE);
        expect(observed.beforeRelease).to.equal(SourceEligibility.ELIGIBLE);
        expect(observed.after).to.equal(SourceEligibility.ELIGIBLE);
    });
    it("an unseen slash does not force a read on an existing positive cache hit", async () => {
        await assertSlashAdmission("unseen");
    });

    it("current membership is an O(1) cached hit with no chain or VM reads", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const observed = await observeSourceEligibility(
            h,
            h.getPeer(1).address,
            { refresh: true }
        );
        expect(observed.result).to.equal(SourceEligibility.ELIGIBLE);
        expect(observed.reads.chainReads).to.equal(0);
        expect(observed.reads.localMembershipReads).to.equal(0);
    });

    it("equivalent address casing uses the same cached identity", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const observed = await observeSourceEligibility(
            h,
            h.getPeer(1).address,
            { refresh: true, lowercase: true }
        );
        expect(observed.result).to.equal(SourceEligibility.ELIGIBLE);
        expect(observed.reads.chainReads).to.equal(0);
    });

    it("an unknown source refreshes once and remains absent", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const observed = await observeSourceEligibility(
            h,
            ethers.Wallet.createRandom().address,
            { refresh: true }
        );
        expect(observed.result).to.equal(SourceEligibility.ABSENT);
        expect(observed.reads.chainReads).to.equal(1);
        // Snapshot event processing checks local participation after updating the mirrors.
        expect(observed.reads.localMembershipReads).to.equal(1);
    });

    it("concurrent cache misses share one refresh and decide from chain membership", async () => {
        const observed = await concurrentUnknownEligibility();
        expect(observed.results).to.deep.equal([
            SourceEligibility.ABSENT,
            SourceEligibility.ABSENT
        ]);
        expect(observed.beforeRelease.chainReads).to.equal(1);
        expect(observed.afterRelease.chainReads).to.equal(1);
    });

    it("a failed provider read leaves cached members intact and allows a later retry", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const source = ethers.Wallet.createRandom().address;
        const failed = await observeSourceEligibility(h, source, {
            refresh: true,
            failRead: true
        });
        expect(failed.result).to.equal(SourceEligibility.ABSENT);
        const existing = await observeSourceEligibility(
            h,
            h.getPeer(1).address,
            { refresh: true }
        );
        expect(existing.result).to.equal(SourceEligibility.ELIGIBLE);
        expect(existing.reads.chainReads).to.equal(0);
        const retry = await observeSourceEligibility(h, source, {
            refresh: true
        });
        expect(retry.result).to.equal(SourceEligibility.ABSENT);
        expect(retry.reads.chainReads).to.equal(1);
    });

    it("reset removes both cached sets until a verified chain refresh", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const observed = await observeSourceEligibility(
            h,
            h.getPeer(1).address,
            { reset: true, refresh: true }
        );
        expect(observed.before).to.equal(SourceEligibility.ABSENT);
        expect(observed.after).to.equal(SourceEligibility.ELIGIBLE);
        expect(observed.reads.chainReads).to.equal(1);
    });

    it("a delivered join event makes a pending-only sender a cache hit", async () => {
        const h = TestSession.getHarness();
        const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
        const control = h.control(h.getPeer(0));
        await control.stub.observeAdmission().request();
        try {
            await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await h.assert.storage.honestPeersObserveInboundMessageWait();
            await waitFor(
                async () =>
                    (await control.query
                        .getSourceEligibility(prepared.joiner.address)
                        .request()) === SourceEligibility.ELIGIBLE
            );
            const result = await h.execOnHost(
                h.getPeer(0),
                (sm, args) =>
                    sm.membershipService.resolveSourceEligibility(args.source),
                { source: prepared.joiner.address }
            );
            const reads = await control.stub
                .getAdmissionObservation()
                .request();
            expect(result).to.equal(SourceEligibility.ELIGIBLE);
            expect(reads.chainReads).to.equal(0);
            expect(reads.localMembershipReads).to.equal(0);
        } finally {
            await control.stub.restoreAdmissionObservation().request();
        }
    });

    it("a pushed snapshot preserves unconsumed pending JOINs without a membership read", async () => {
        const h = TestSession.getHarness();
        const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
        await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        await h.assert.storage.honestPeersObserveInboundMessageWait();
        const observer = h.getPeer(0);
        const control = h.control(observer);
        await control.stub.observeAdmission().request();
        try {
            const result = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const snapshot =
                        await sm.stateChannelManagerContract.getStateSnapshot(
                            sm.channelId
                        );
                    sm.membershipService.publishOnChainSnapshot(snapshot);
                    return sm.membershipService.getCachedSourceEligibility(
                        args.source
                    );
                },
                { source: prepared.joiner.address }
            );
            expect(result).to.equal(SourceEligibility.ELIGIBLE);
            const reads = await control.stub
                .getAdmissionObservation()
                .request();
            expect(reads.chainReads).to.equal(0);
            expect(reads.localMembershipReads).to.equal(0);
        } finally {
            await control.stub.restoreAdmissionObservation().request();
        }
    });

    describe("connect membership reuse", function () {
        it("already-open join forwards supplied and default balances with an internal deadline", async function () {
            const h = TestSession.getHarness();
            await h.setup(4, { autoConnect: false });
            const channelId = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string"],
                    [h.options.channelId]
                )
            );
            await h.lifecycle.openChannelForParticipants([0, 1]);
            await h.network.joinSelectedKey([0, 1], String(channelId));

            expect(
                await h
                    .getPeer(2)
                    .p2pInstance.p2pSigner.connectToChannel(channelId, {
                        shouldJoin: true,
                        balance: { amount: 321n, data: "0x1234" }
                    })
            ).to.equal(true);
            expect(
                await h
                    .getPeer(3)
                    .p2pInstance.p2pSigner.connectToChannel(channelId, {
                        shouldJoin: true
                    })
            ).to.equal(true);
            expect(
                await Promise.all(
                    [2, 3].map((index) =>
                        h.control(h.getPeer(index)).query.getStatus().request()
                    )
                )
            ).to.deep.equal([
                Status.PENDING_PARTICIPANT,
                Status.PENDING_PARTICIPANT
            ]);
        });

        it("finite matchmaking timeout does not settle a first-join receipt wait", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const release = await h.rpcStub.holdMembershipReceipt(
                prepared.joiner.index,
                "joinChannel"
            );
            let settled = false;
            const connect = prepared.joiner.p2pInstance.p2pSigner
                .connectToChannel(h.channelId, {
                    shouldJoin: true,
                    timeoutMs: 25
                })
                .finally(() => {
                    settled = true;
                });
            try {
                await waitFor(
                    () =>
                        h
                            .control(prepared.joiner)
                            .stub.getHeldMembershipReceiptCount()
                            .request()
                            .then((count) => count === 1),
                    h.event.protocolEventTimeoutMs()
                );
                await sleep(50);
                expect(settled).to.equal(false);
                await release();
                expect(await connect).to.equal(true);
            } finally {
                await release();
            }
        });

        it("finite matchmaking timeout does not settle a top-up receipt wait", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            const release = await h.rpcStub.holdMembershipReceipt(
                prepared.joiner.index,
                "topUpBalance"
            );
            let settled = false;
            const connect = prepared.joiner.p2pInstance.p2pSigner
                .connectToChannel(h.channelId, {
                    shouldJoin: true,
                    balance: { amount: 9n, data: "0xbeef" },
                    timeoutMs: 25
                })
                .finally(() => {
                    settled = true;
                });
            try {
                await waitFor(
                    () =>
                        h
                            .control(prepared.joiner)
                            .stub.getHeldMembershipReceiptCount()
                            .request()
                            .then((count) => count === 1),
                    h.event.protocolEventTimeoutMs()
                );
                await sleep(50);
                expect(settled).to.equal(false);
                await release();
                expect(await connect).to.equal(true);
            } finally {
                await release();
            }
        });

        it("pending participant without balance sends zero transactions and returns true", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId,
                    { shouldJoin: true }
                )
            ).to.equal(true);
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
        });

        it("pending participant with balance sends one top-up transaction and returns true after its receipt", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId,
                    {
                        shouldJoin: true,
                        balance: { amount: 9n, data: "0xbeef" }
                    }
                )
            ).to.equal(true);
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
        });

        it("participating signer without balance sends zero transactions and returns true", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    postPromotionTransitions: 0
                }
            );
            expect(
                await joiner.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId,
                    { shouldJoin: true }
                )
            ).to.equal(true);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("participating signer with balance sends one top-up transaction and returns true after its receipt", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    postPromotionTransitions: 0
                }
            );
            expect(
                await joiner.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId,
                    {
                        shouldJoin: true,
                        balance: { amount: 11n, data: "0xcafe" }
                    }
                )
            ).to.equal(true);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
        });
    });

    describe("joinChannel", function () {
        it("marks PENDING_PARTICIPANT before invoking join submission", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
                prepared.joiner.index,
                "joinChannel"
            );
            try {
                const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
                await waitFor(
                    async () =>
                        (await h
                            .control(prepared.joiner)
                            .stub.getHeldMembershipReceiptCount()
                            .request()) === 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await h.control(prepared.joiner).query.getStatus().request()
                ).to.equal(Status.PENDING_PARTICIPANT);
                await releaseSubmission();
                expect(await join).to.equal(true);
            } finally {
                await releaseSubmission();
            }
        });

        it("rejects a duplicate first join while submission is pending", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const first = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            let duplicateError = "";
            try {
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (error) {
                duplicateError =
                    error instanceof Error ? error.message : String(error);
            }
            expect(duplicateError).to.contain(
                "joinChannel requires SYNCED status"
            );
            expect(await first).to.equal(true);
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
        });

        it("direct joinChannel receipt failure restores SYNCED", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const restore = await h.rpcStub.failMembershipReceipt(
                prepared.joiner.index,
                "joinChannel"
            );
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);
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

        it("uncertain join submission preserves pending protection", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const restore = await h.rpcStub.failMembershipSubmissionUncertain(
                prepared.joiner.index,
                "joinChannel"
            );
            try {
                expect(
                    await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    )
                ).to.equal(false);
                expect(
                    await h.control(prepared.joiner).query.getStatus().request()
                ).to.equal(Status.PENDING_PARTICIPANT);
                expect(
                    await h.execOnHost(
                        h.getPeer(prepared.joiner.index),
                        async (sm) =>
                            sm.storage.forceJoin.getJoinSubmissionBlockHeight() !==
                            undefined
                    )
                ).to.equal(true);
                expect(
                    await new TargetedChannelJoinFixture(h).isDisposed(
                        prepared.joiner
                    )
                ).to.equal(false);
            } finally {
                await restore();
            }
        });

        it("direct joinChannel revert after pending preserves the channel", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            let message = "";
            try {
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (error) {
                message =
                    error instanceof Error ? error.message : String(error);
            }
            expect(message).to.contain("joinChannel requires SYNCED status");
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await new TargetedChannelJoinFixture(h).isDisposed(
                    prepared.joiner
                )
            ).to.equal(false);
        });

        it("direct joinChannel revert after participating preserves the channel", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    postPromotionTransitions: 0
                }
            );
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });

            let message = "";
            try {
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (error) {
                message =
                    error instanceof Error ? error.message : String(error);
            }
            expect(message).to.contain("joinChannel requires SYNCED status");
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
            expect(
                await new TargetedChannelJoinFixture(h).isDisposed(joiner)
            ).to.equal(false);
        });

        it("replayed after the joiner is already PARTICIPATING → rejected on status, membership untouched", async function () {
            const h = TestSession.getHarness();
            const joiner =
                await h.scenario.spectatorPromotedViaJoinChannelWait();

            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);

            // the same confirmation the promotion used, replayed
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });

            let message = "no throw";
            try {
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain("joinChannel requires SYNCED status");
            // the guard runs before any status change or force-join bookkeeping
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
        });
    });

    describe("topUpBalance", function () {
        it("a synced non-participant tops up → rejected on status", async function () {
            const h = TestSession.getHarness();
            const { joiner } = await h.scenario.syncSpectatorAndPrepareJoin();

            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.SYNCED);

            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });

            let message = "no throw";
            try {
                await joiner.p2pInstance.p2pSigner.topUpBalance(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain(
                "topUpBalance requires PARTICIPATING or PENDING_PARTICIPANT status"
            );
        });
    });

    describe("maybeInitiateForceJoinDispute", function () {
        it("no recorded join submission height → nothing disputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);

            // any dispute this would raise is recorded instead of submitted
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(
                        args.forkId
                    )!;
                    const participants =
                        await sm.diamondStateMachine.getParticipants();
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );
                    return true;
                },
                { forkId }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
            h.assert.dispute.noDisputes();
            await recorder.restore();
        });

        it("defers force join until on-chain membership and a usable dispute window", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(1);
            const joiner = h.getPeer(prepared.joiner.index);
            const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
                prepared.joiner.index,
                "joinChannel"
            );
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                prepared.joiner.index
            );
            try {
                const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
                await waitFor(
                    async () =>
                        (await h
                            .control(prepared.joiner)
                            .stub.getHeldMembershipReceiptCount()
                            .request()) === 1,
                    h.event.protocolEventTimeoutMs()
                );

                const absentResult = await h.execOnHost(joiner, async (sm) => {
                    const block = sm.storage.blocks.getLatestBlock(sm.forkId)!;
                    const participants =
                        await sm.diamondStateMachine.getParticipants();
                    sm.storage.forceJoin.setJoinSubmissionBlockHeight(
                        block.height - participants.length - 1
                    );
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );
                    return {
                        disputeStarted:
                            sm.storage.forceJoin.hasDisputeStarted(),
                        markerRetained:
                            sm.storage.forceJoin.getJoinSubmissionBlockHeight() !==
                            undefined
                    };
                });
                expect(absentResult).to.deep.equal({
                    disputeStarted: false,
                    markerRetained: true
                });
                expect(await recorder.submissions()).to.have.length(0);

                await releaseSubmission();
                expect(await join).to.equal(true);
                expect(
                    await h
                        .control(prepared.joiner)
                        .query.getOnChainParticipantUnion()
                        .request()
                ).to.include(prepared.joiner.address);

                const latestChainBlock = await h.provider.getBlock("latest");
                expect(latestChainBlock).to.not.equal(null);
                const evidenceTime = await h.execOnHost(
                    joiner,
                    async (sm) => sm.timeConfig.evidenceTime
                );
                const expiredWindowTimestamp = Math.max(
                    1,
                    latestChainBlock!.timestamp - evidenceTime
                );
                const expiredResult = await h.execOnHost(
                    joiner,
                    async (sm, args) => {
                        const getWindow =
                            sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp.bind(
                                sm.diamondStateMachine.localDiamondContract
                            );
                        Reflect.set(
                            sm.diamondStateMachine.localDiamondContract,
                            "getDisputeWindowCreationTimestamp",
                            async () => BigInt(args.windowTimestamp)
                        );
                        try {
                            const block = sm.storage.blocks.getLatestBlock(
                                sm.forkId
                            )!;
                            const participants =
                                await sm.diamondStateMachine.getParticipants();
                            sm.storage.forceJoin.setJoinSubmissionBlockHeight(
                                block.height - participants.length - 1
                            );
                            await sm.membershipService.maybeInitiateForceJoinDispute(
                                block,
                                participants
                            );
                            return {
                                disputeStarted:
                                    sm.storage.forceJoin.hasDisputeStarted(),
                                markerRetained:
                                    sm.storage.forceJoin.getJoinSubmissionBlockHeight() !==
                                    undefined
                            };
                        } finally {
                            Reflect.set(
                                sm.diamondStateMachine.localDiamondContract,
                                "getDisputeWindowCreationTimestamp",
                                getWindow
                            );
                        }
                    },
                    { windowTimestamp: expiredWindowTimestamp }
                );
                expect(expiredResult).to.deep.equal({
                    disputeStarted: false,
                    markerRetained: true
                });
                expect(await recorder.submissions()).to.have.length(0);

                await h.execOnHost(joiner, async (sm) => {
                    const getWindow =
                        sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp.bind(
                            sm.diamondStateMachine.localDiamondContract
                        );
                    Reflect.set(
                        sm.diamondStateMachine.localDiamondContract,
                        "getDisputeWindowCreationTimestamp",
                        async () => 0n
                    );
                    try {
                        const block = sm.storage.blocks.getLatestBlock(
                            sm.forkId
                        )!;
                        const participants =
                            await sm.diamondStateMachine.getParticipants();
                        await sm.membershipService.maybeInitiateForceJoinDispute(
                            block,
                            participants
                        );
                        await sm.membershipService.maybeInitiateForceJoinDispute(
                            block,
                            participants
                        );
                    } finally {
                        Reflect.set(
                            sm.diamondStateMachine.localDiamondContract,
                            "getDisputeWindowCreationTimestamp",
                            getWindow
                        );
                    }
                    return true;
                });
                await waitFor(
                    async () => (await recorder.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await recorder.submissions()).to.have.length(1);
            } finally {
                await releaseSubmission();
                await recorder.restore();
            }
        });

        it("fires exactly at joinSubmissionHeight + participants + 1", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.transition.advanceState({ count: 5 });

            const observer = h.getPeer(0);
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );
            try {
                const result = await h.execOnHost(observer, async (sm) => {
                    const block = sm.storage.blocks.getLatestBlock(sm.forkId)!;
                    const participants =
                        await sm.diamondStateMachine.getParticipants();
                    const triggerOffset = participants.length + 1;

                    sm.storage.forceJoin.setJoinSubmissionBlockHeight(
                        block.height - triggerOffset + 1
                    );
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );
                    const startedOneBlockEarly =
                        sm.storage.forceJoin.hasDisputeStarted();

                    sm.storage.forceJoin.setJoinSubmissionBlockHeight(
                        block.height - triggerOffset
                    );
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );

                    return {
                        blockHeight: block.height,
                        participantCount: participants.length,
                        startedOneBlockEarly,
                        startedAtThreshold:
                            sm.storage.forceJoin.hasDisputeStarted()
                    };
                });

                expect(result.startedOneBlockEarly).to.equal(false);
                expect(result.startedAtThreshold).to.equal(true);
                expect(result.blockHeight).to.be.greaterThan(
                    result.participantCount + 1
                );
                await waitFor(
                    async () => (await recorder.submissions()).length === 1,
                    h.event.protocolEventTimeoutMs()
                );
                expect(await recorder.submissions()).to.have.length(1);
            } finally {
                await recorder.restore();
            }
        });
    });

    describe("startMaybeExitOnChain", function () {
        it("a clean leave everyone signed → snapshot path, no force-exit flag", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const leaverIndex = await h.transition.participantLeaveWait();
            const leaver = h.getPeer(leaverIndex);

            // the leave block carries every signature, so the exit takes the
            // N/N snapshot path and never marks a self-removal dispute
            const forcedExit = await h.execOnHost(leaver, async (sm) =>
                sm.storage.forceExit.getForceExit()
            );

            expect(forcedExit).to.equal(false);
            expect(
                await h.control(leaver).query.getStatus().request()
            ).to.equal(Status.SYNCED);
        });

        it("I did not leave → returns without scheduling an exit", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);

            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            const outcome = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(
                        args.forkId
                    )!;
                    const snapshot =
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            block.stateSnapshotHash
                        )!;
                    await sm.membershipService.startMaybeExitOnChain(
                        block,
                        snapshot,
                        { left: new Set(), joined: new Set() }
                    );
                    return sm.storage.forceExit.getForceExit();
                },
                { forkId }
            );

            expect(outcome).to.equal(false);
            expect(await recorder.submissions()).to.deep.equal([]);
            await recorder.restore();
        });
    });
});
