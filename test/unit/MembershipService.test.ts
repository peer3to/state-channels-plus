import { hash as randomHash } from "../factory";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { Status } from "@/types";
import { sleep } from "@/utils";
import {
    checkForceJoinOnLatestBlock,
    readTrackedJoin,
    runForceJoinBlockBound,
    waitForJoinChecks
} from "@test/fixtures/ForceJoinCountingStaging";
import {
    applyJoinBlockFromLiveAndRefresh,
    readSignerMembershipLookups,
    recordPendingJoinerChainCalls,
    refreshAfterEligibilityReset,
    refreshAppliedAfterLiveSnapshot,
    refreshFillsMirrorBelowHead,
    refreshWithFailedRecoveredInboundBlock,
    relayAfterEligibilityReset,
    stageMirroredPendingJoin,
    stagePendingJoinMirroredByJoiner,
    stagePendingJoinMissedByJoinerMirror
} from "@test/fixtures/PendingJoinEligibilityStaging";
import {
    assertSlashAdmission,
    assertSlashRefreshFailure,
    refreshWithFailedRecoveredSlash
} from "@test/fixtures/QueueSlashFixture";
import {
    concurrentUnknownEligibility,
    missingInboundEligibility,
    eligibilityAppearsDuringRefresh,
    observeSourceEligibility,
    observeSlashDuringRefresh,
    publishChainSnapshotEligibility
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

    it("an unopened channel refresh has no eligible source", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        // a runtime owns one channel: a fresh one selects the unopened channel
        const fresh = h.getPeer(
            (await new TargetedChannelJoinFixture(h).addFreshPeer()).index
        );
        const result = await h.execOnHost(
            fresh,
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
        // The replayed snapshot lists this signer, so its event processing
        // reads no local participation.
        expect(observed.reads.localMembershipReads).to.equal(0);
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

    it("a refresh while the local diamond holds a pending JOIN applies its inbound block again as a no-op and applies the snapshot", async () => {
        const h = TestSession.getHarness();
        const joiner = await stageMirroredPendingJoin(h);
        const observed = await refreshAfterEligibilityReset(h, [
            h.getPeer(1).address,
            h.getPeer(2).address,
            joiner.address
        ]);
        expect(observed.refreshed).to.equal(true);
        expect(observed.eligibility).to.deep.equal([
            SourceEligibility.ELIGIBLE,
            SourceEligibility.ELIGIBLE,
            SourceEligibility.ELIGIBLE
        ]);
        expect(observed.isMirrorAtChainInboundHead).to.equal(true);
    });

    it("the live log's application of an inbound block, then the refresh's, stores it once without a revert", async () => {
        const h = TestSession.getHarness();
        const observed = await applyJoinBlockFromLiveAndRefresh(h, "recorded");
        expect(observed.refreshed).to.equal(true);
        expect(observed.heldCount).to.equal(2);
        expect(observed.mirror.heldBlocks).to.deep.equal([true]);
        expect(observed.mirror.isHeadAtChain).to.equal(true);
        expect(observed.mirror.isTotalDepositsAtChain).to.equal(true);
    });

    it("the refresh's application of an inbound block, then the live log's, stores it once without a revert", async () => {
        const h = TestSession.getHarness();
        const observed = await applyJoinBlockFromLiveAndRefresh(h, "reverse");
        expect(observed.refreshed).to.equal(true);
        expect(observed.heldCount).to.equal(2);
        expect(observed.mirror.heldBlocks).to.deep.equal([true]);
        expect(observed.mirror.isHeadAtChain).to.equal(true);
        expect(observed.mirror.isTotalDepositsAtChain).to.equal(true);
    });

    it("a refresh fills an inbound block the local diamond misses below its head without moving the head back", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const observed = await refreshFillsMirrorBelowHead(h);
        expect(observed.before.heldBlocks).to.deep.equal([false, true]);
        expect(observed.before.isHeadAtChain).to.equal(true);
        expect(observed.refreshed).to.equal(true);
        expect(observed.after.heldBlocks).to.deep.equal([true, true]);
        expect(observed.after.isHeadAtChain).to.equal(true);
        expect(observed.after.isTotalDepositsAtChain).to.equal(true);
    });

    it("a refresh read before a live snapshot update does not overwrite that newer snapshot in the local diamond or in membership", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        const observed = await refreshAppliedAfterLiveSnapshot(h);
        expect(observed.refreshed).to.equal(true);
        expect(observed.mirror.isSnapshotAtChain).to.equal(true);
        expect(observed.membership.isMirroredSnapshotPublished).to.equal(true);
    });

    it("a pending joiner's refresh makes only its pinned multicall chain call", async () => {
        const h = TestSession.getHarness();
        const joiner = h.getPeer((await stageMirroredPendingJoin(h)).index);
        const observed = await recordPendingJoinerChainCalls(
            h,
            joiner,
            "refresh"
        );
        expect(observed.status).to.equal(Status.PENDING_PARTICIPANT);
        expect(observed.result).to.equal(true);
        expect(observed.calls).to.deep.equal([
            "multicall",
            "multicall:getOnChainSlashedParticipants",
            "multicall:getStateSnapshot",
            "multicall:getChannelBalance"
        ]);
    });

    it("a pending joiner whose local diamond holds its JOIN applies a snapshot without a pending-set chain read", async () => {
        const h = TestSession.getHarness();
        const joiner = await stagePendingJoinMirroredByJoiner(h);
        // the departure check reaches its pending lookup: the joiner is in
        // neither the snapshot nor its local state
        expect(await readSignerMembershipLookups(h, joiner)).to.deep.include({
            isInLocalState: false,
            isPendingInMirror: true
        });
        const observed = await recordPendingJoinerChainCalls(
            h,
            joiner,
            "onChainSnapshot"
        );
        expect(observed.status).to.equal(Status.PENDING_PARTICIPANT);
        expect(observed.calls).to.deep.equal(["getStateSnapshot"]);
    });

    it("a pending joiner whose local diamond misses its JOIN reads the pending set from the chain once", async () => {
        const h = TestSession.getHarness();
        const staged = await stagePendingJoinMissedByJoinerMirror(h);
        expect(staged.isOwnJoinMirrored).to.equal(false);
        expect(
            await readSignerMembershipLookups(h, staged.joiner)
        ).to.deep.include({
            isInLocalState: false,
            isListedPendingOnChain: true
        });
        const observed = await recordPendingJoinerChainCalls(
            h,
            staged.joiner,
            "onChainSnapshot"
        );
        expect(observed.status).to.equal(Status.PENDING_PARTICIPANT);
        expect(observed.calls).to.deep.equal([
            "getStateSnapshot",
            "getPendingParticipants"
        ]);
    });

    it("a pending JOIN the chain lists but the joiner's local mirror misses is not observed locally and starts no force-join counters", async () => {
        const h = TestSession.getHarness();
        const { joiner } = await stagePendingJoinMissedByJoinerMirror(h);
        // the snapshot application runs the joiner's join check
        await recordPendingJoinerChainCalls(h, joiner, "onChainSnapshot");
        await waitForJoinChecks(h, joiner);
        expect(await readSignerMembershipLookups(h, joiner)).to.deep.include({
            isListedPendingOnChain: true,
            isPendingInMirror: false,
            isPendingOnChain: true
        });
        const join = await readTrackedJoin(h, joiner);
        expect(join).to.not.equal(null);
        expect(join!.countingStartsAt).to.equal(undefined);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
    });

    it("a seated participant absent from the mirror's and the chain's pending sets is not pending on chain", async () => {
        const h = TestSession.getHarness();
        await stageMirroredPendingJoin(h);
        expect(
            await readSignerMembershipLookups(h, h.getPeer(0))
        ).to.deep.include({
            isListedPendingOnChain: false,
            isPendingInMirror: false,
            isPendingOnChain: false
        });
    });

    it("a participant seated on chain with no pending entry is on chain", async () => {
        const h = TestSession.getHarness();
        await stageMirroredPendingJoin(h);
        expect(
            await readSignerMembershipLookups(h, h.getPeer(0))
        ).to.deep.include({
            isSeatedOnChain: true,
            isListedPendingOnChain: false,
            isOnChain: true
        });
    });

    it("a joiner pending on chain and missed by its local mirror is on chain", async () => {
        const h = TestSession.getHarness();
        const { joiner } = await stagePendingJoinMissedByJoinerMirror(h);
        expect(await readSignerMembershipLookups(h, joiner)).to.deep.include({
            isSeatedOnChain: false,
            isListedPendingOnChain: true,
            isPendingInMirror: false,
            isOnChain: true
        });
    });

    it("a snapshot participant unknown to the cache while a JOIN is pending is admitted, not blacklisted", async () => {
        const h = TestSession.getHarness();
        await stageMirroredPendingJoin(h, 1);
        expect(await relayAfterEligibilityReset(h)).to.equal(0);
        const receiver = h.control(h.getPeer(0));
        expect(
            await receiver.query.isBlacklisted(h.getPeer(1).address).request()
        ).to.equal(false);
        expect(
            await receiver.query.isConnectedTo(h.getPeer(1).address).request()
        ).to.equal(true);
    });

    it("a local diamond failure during a refresh throws instead of reporting the refresh unavailable", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        await h.mirror.failNextUpdate(0, "onStateSnapshotUpdated");
        const outcome = await h.execOnHost(h.getPeer(0), async (sm) => {
            try {
                return {
                    refreshed:
                        await sm.membershipService.refreshOnChainEligibility(),
                    error: null
                };
            } catch (error) {
                return {
                    refreshed: null,
                    error:
                        error instanceof Error ? error.message : String(error)
                };
            }
        });
        expect(outcome.refreshed).to.equal(null);
        expect(outcome.error).to.be.a("string");
    });

    it("a local diamond failure applying a recovered slash log during a refresh throws instead of reporting the refresh unavailable", async () => {
        const outcome = await refreshWithFailedRecoveredSlash();
        expect(outcome.refreshed).to.equal(null);
        expect(outcome.error).to.match(
            /^Local contract call failed: Error: Local EVM execution failed: revert/
        );
    });

    it("a local diamond failure applying a recovered inbound log during a refresh throws instead of reporting the refresh unavailable", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const outcome = await refreshWithFailedRecoveredInboundBlock(h);
        expect(outcome.refreshed).to.equal(null);
        expect(outcome.error).to.match(
            /^Local contract call failed: Error: Local EVM execution failed: revert/
        );
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

    it("a JOIN in the linked part above a missing inbound block is eligible after a pushed snapshot", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const lagging = h.getPeer(2);
        // exactly one inbound log is lost, so the next one still lands and the
        // store tip moves above the hole
        const dropped = await h.rpcStub.dropInboundMessageLogs(lagging.index, {
            dropCount: 1
        });
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address,
            observePeerIndices: [0, 1]
        });
        await dropped.waitUntilDropped();
        // a new participant's JOIN lands above the hole
        const { participant } = await h.join.forceInboundJoinWait();

        const result = await publishChainSnapshotEligibility(
            h,
            lagging.index,
            participant,
            { reset: true }
        );

        // premise - the range from the tip down to the snapshot is truncated,
        // and the snapshot itself does not list the new participant
        expect(result.missingBlockHash).to.not.equal(null);
        expect(result.linkedBlockCount).to.equal(1);
        expect(result.inSnapshot).to.equal(false);
        expect(result.eligibility).to.equal(SourceEligibility.ELIGIBLE);
        await dropped.release();
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
            const result = await publishChainSnapshotEligibility(
                h,
                observer.index,
                prepared.joiner.address
            );
            expect(result.eligibility).to.equal(SourceEligibility.ELIGIBLE);
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

        it("a duplicate first join while submission is pending shares the running submission", async function () {
            const h = TestSession.getHarness();
            const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
            const join = () =>
                prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            const [first, duplicate] = await Promise.all([join(), join()]);
            expect(first).to.equal(true);
            expect(duplicate).to.equal(true);
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
                    await readTrackedJoin(h, h.getPeer(prepared.joiner.index))
                ).to.not.equal(null);
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

    describe("force join dispute", function () {
        it("no recorded join submission height → nothing disputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);

            // any dispute this would raise is recorded instead of submitted
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            expect(
                await checkForceJoinOnLatestBlock(h, observer)
            ).to.deep.equal({ disputeStarted: false, markerRetained: false });

            expect(await recorder.submissions()).to.deep.equal([]);
            h.assert.dispute.noDisputes();
            await recorder.restore();
        });

        it("force join waits for its JOIN to land and submits only once at the block bound", async function () {
            const run = await runForceJoinBlockBound(TestSession.getHarness(), {
                holdJoinSubmission: true
            });
            expect(run.beforeLanding).to.deep.equal({
                disputeStarted: false,
                markerRetained: true,
                submissions: 0
            });
            expect(run.atBound.latestBlockHeight).to.equal(
                run.firstCountedHeight + run.bound
            );
            expect(run.atBound.disputeStarted).to.equal(true);
            expect(run.submissionsAtBound).to.equal(1);
            expect(run.submissionsAfterRecheck).to.equal(1);
        });

        it("U77: after the agreementTime grace, fires exactly at the first counted block + participants + 1", async function () {
            // A real joiner observes its own landed join; the founders omit
            // it and author through the grace, below the bound and at it.
            const run = await runForceJoinBlockBound(TestSession.getHarness());

            expect(run.belowBound.countingFromHeight).to.equal(
                run.firstCountedHeight
            );
            expect(run.belowBound.latestBlockHeight).to.equal(
                run.firstCountedHeight + run.bound - 1
            );
            expect(run.belowBound.disputeStarted).to.equal(false);
            expect(run.submissionsBelowBound).to.equal(0);

            expect(run.atBound.latestBlockHeight).to.equal(
                run.firstCountedHeight + run.bound
            );
            expect(run.atBound.disputeStarted).to.equal(true);
            expect(run.submissionsAtBound).to.equal(1);
        });
    });

    describe("own exit block", function () {
        it("a clean leave everyone signed → snapshot path, force-exit flag kept", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const leaverIndex = await h.transition.participantLeaveWait();
            const leaver = h.getPeer(leaverIndex);

            expect(
                await h.control(leaver).query.getStatus().request()
            ).to.equal(Status.SYNCED);
            // the posted snapshot lands the exit; a started exit is never
            // retracted
            expect(
                await h.control(leaver).query.getForceExit().request()
            ).to.equal(true);
        });
    });
});
