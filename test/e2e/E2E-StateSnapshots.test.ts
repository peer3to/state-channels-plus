import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { StateSnapshot } from "@/models";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { expect } from "chai";

/**
 * E2E Tests for State Snapshot Posting
 *
 * Maps to: src/stateManager/StateManager.ts (postStateSnapshot, multicall path)
 *          State snapshot on-chain updates after transitions and fork resolution.
 *
 * Covers: posting snapshot after N transitions, 2 independent snapshot updates
 * after fork resolution, and single multicall (fork + same-fork) update.
 */
describe("E2E: State Snapshots", function () {
    const forkTimeConfig = {
        p2pTime: 3,
        agreementTime: 2,
        chainFallbackTime: 2,
        evidenceTime: 3
    };

    it("should post updated state snapshot on-chain after 3 transitions", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, { timeConfig: { agreementTime: 4 } });

        await h.transition.advanceState();
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        await h.transition.advanceState();

        await h.assert.sync.peersInSyncWait();
        h.event.resetEventSpies();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.transition.postSnapshot();
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            h.peers.map((peer) => ({ peerId: peer.index, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.assert.snapshot.snapshotMatchesLocal();
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates", async function () {
        const h = TestSession.getHarness();
        await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateDetached({
            timeConfig: { ...forkTimeConfig, agreementTime: 4 }
        });

        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
        await h.transition.fromHonestPeersOnly((c) => c.add(3));
        await h.assert.sync.onlyHonestPeersInSync();
        h.event.resetEventSpies();

        await await h.assert.sync.onChainSnapshotAndPeersSameForkWait();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        h.event.resetEventSpies();
        await h.transition.postSnapshot();

        const honest = h.getHonestPeers().map((p) => p.index);
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            honest.map((peerId) => ({ peerId, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.assert.snapshot.snapshotMatchesLocal();
        await h.assert.sync.maliciousPeerExcluded();
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - multicall", async function () {
        const h = TestSession.getHarness();

        //  longer agreement time to prevent StateManger.startMaybeExitOnChain to update the on-chain snapshot
        //  before this test doesit - the point of this test is to exercise the multicall path for fork updates
        await h.scenario.fourPeersDisputeResolution({
            timeConfig: { ...forkTimeConfig, agreementTime: 4 }
        });
        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
        await h.transition.fromHonestPeersOnly((c) => c.add(3));

        await h.assert.sync.onlyHonestPeersInSync();
        h.event.resetEventSpies();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.transition.postSnapshot();

        const honest = h.getHonestPeers().map((p) => p.index);
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            honest.map((peerId) => ({ peerId, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.assert.snapshot.onChainSnapshotOnFork();
        await h.assert.snapshot.snapshotMatchesLocal();
        await h.assert.sync.maliciousPeerExcluded();
    });

    it("should not re-emit setState when a held old-fork reduction timeout runs after snapshot-event reduction", async function () {
        this.timeout(90000);

        const h = TestSession.getHarness();
        const targetPeerIndex = 0;
        const maliciousPeerIndex = 2;
        const honest = [0, 1, 3];

        // 2 = warm-up transitions the dispute staging needs, not the peer index.
        await h.lifecycle.start(4, 2, {
            timeConfig: { ...forkTimeConfig, agreementTime: 4 }
        });
        await h.assert.sync.peersInSyncWait();

        const targetPeer = h.getPeer(targetPeerIndex);
        // Hold only the reduction timers - the snapshot event must flow and
        // perform the reduction; the held timer replays after it.
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();

        h.event.resetEventSpies();
        const originalForkId = h.activeForkId!;
        await h.scenario.disputeAndResolve({
            maliciousPeerIndex,
            forkId: originalForkId,
            honestPeerIndices: honest,
            resetEventSpies: false,
            forkSettleTimeoutMs: 20000,
            disputesCommittedTimeoutMs: 10000
        });

        const heldReductionCount = await h
            .control(targetPeer)
            .stub.getHeldReductionTaskCount()
            .request();
        expect(heldReductionCount).to.be.greaterThan(
            0,
            "target peer should have a pending old-fork reduction timeout held by the test"
        );

        await h.event.waitForPeers("onSetState", [targetPeerIndex], 1, {
            timeoutMs: 20000,
            mode: "atLeast"
        });
        expect(
            h.event.getEventCallCount(targetPeerIndex, "onSetState")
        ).to.equal(
            1,
            "target peer should set reduced-fork state once from the snapshot event"
        );

        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.assert.sync.onlyHonestPeersInSync();

        const expectedSum = await h
            .getPeer(targetPeerIndex)
            .contractInstance.getSum();

        // Release: restore scheduling and run the held reduction timers -
        // they must no-op against the already-reduced fork.
        await h.control(targetPeer).stub.restoreReductionTasks(true).request();

        await h.event.waitWhileEventCountsStayAtMost(
            "onSetState",
            [targetPeerIndex],
            {
                durationMs: 5000,
                maxCount: 1
            }
        );
        expect(
            h.event.getEventCallCount(targetPeerIndex, "onSetState")
        ).to.equal(
            1,
            "old-fork reduction timeout should skip after snapshot-event reduction"
        );
        expect(
            await h.getPeer(targetPeerIndex).contractInstance.getSum()
        ).to.equal(expectedSum, "target peer should retain the transition");
    });

    it("should not re-emit setState when an already-entered old-fork reduction completes after snapshot-event reduction", async function () {
        this.timeout(90000);

        const h = TestSession.getHarness();
        const targetPeerIndex = 0;
        const maliciousPeerIndex = 2;
        const reducingHonestPeers = [1, 3];

        // 2 = warm-up transitions the dispute staging needs, not the peer index.
        await h.lifecycle.start(4, 2, {
            timeConfig: {
                ...forkTimeConfig,
                agreementTime: 4
            }
        });
        await h.assert.sync.peersInSyncWait();

        const originalForkId = h.activeForkId!;
        const targetPeer = h.getPeer(targetPeerIndex);

        // Keep the scheduled old-fork reduction parked, then explicitly start
        // a second old-fork reduction and pause it after it enters the contract
        // kill-period check. The snapshot event should reduce the peer while
        // this older reduction is already in flight.
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();
        await h
            .control(targetPeer)
            .stub.stubPauseTryReduceAtKillPeriod(originalForkId)
            .request();

        h.event.resetEventSpies();
        const resolvePromise = h.scenario.disputeAndResolve({
            maliciousPeerIndex,
            forkId: originalForkId,
            honestPeerIndices: reducingHonestPeers,
            resetEventSpies: false,
            forkSettleTimeoutMs: 20000,
            disputesCommittedTimeoutMs: 10000
        });

        try {
            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .stub.getHeldReductionTaskCount()
                        .request()) > 0,
                15000,
                50
            );
            await h
                .control(targetPeer)
                .stub.startPausedTryReduce(originalForkId)
                .request();

            await waitFor(
                async () =>
                    (
                        await h
                            .control(targetPeer)
                            .stub.getPausedTryReduceStatus()
                            .request()
                    ).entered,
                15000,
                50
            );

            await resolvePromise;

            await h.event.waitForPeers("onSetState", [targetPeerIndex], 1, {
                timeoutMs: 20000,
                mode: "atLeast"
            });
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(
                1,
                "target peer should set reduced-fork state once from the snapshot event"
            );

            await h.transition.fromHonestPeersOnly((c) => c.add(1));
            await h.assert.sync.onlyHonestPeersInSync();

            const expectedSum = await h
                .getPeer(targetPeerIndex)
                .contractInstance.getSum();

            await h.control(targetPeer).stub.releasePausedTryReduce().request();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(targetPeer)
                            .stub.getPausedTryReduceStatus()
                            .request()
                    ).settled,
                30000,
                50
            );
            const tryReduceStatus = await h
                .control(targetPeer)
                .stub.getPausedTryReduceStatus()
                .request();
            await h.control(targetPeer).stub.restorePausedTryReduce().request();
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request();
            expect(tryReduceStatus.error).to.equal(undefined);

            await h.event.waitWhileEventCountsStayAtMost(
                "onSetState",
                [targetPeerIndex],
                {
                    durationMs: 2000,
                    maxCount: 1
                }
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(
                1,
                "old-fork reduction already in progress should not set state again"
            );
            expect(
                await h.getPeer(targetPeerIndex).contractInstance.getSum()
            ).to.equal(expectedSum, "target peer should retain the transition");
        } finally {
            // Guarantee the paused in-flight reduction is released on every
            // exit path so it never leaks into teardown.
            await h
                .control(targetPeer)
                .stub.releasePausedTryReduce()
                .request()
                .catch(() => {});
            await h
                .control(targetPeer)
                .stub.restorePausedTryReduce()
                .request()
                .catch(() => {});
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request()
                .catch(() => {});
            await resolvePromise.catch(() => {});
        }
    });

    it("should handle snapshot update at blockHeight = 0 (first snapshot) - edge case since genesis is also height 0", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(3, 0, { timeConfig: { agreementTime: 4 } });
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });

        h.event.resetEventSpies();
        await h.contextApi.capturePrePostSnapshotContext();

        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();

        await h.transition.postSnapshot();

        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            h.peers.map((peer) => ({ peerId: peer.index, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );

        await h.assert.snapshot.withdrawalDeltaMatchesExpected();
        await h.assert.snapshot.verifyOnChainChannelBalanceInvariant();
        await h.assert.snapshot.snapshotMatchesLocal();
        await h.assert.sync.blockHeight({ expectedHeight: 0 });
    });

    it("should update on-chain snapshot to a new fork genesis after dispute resolution", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 2);

        await h.byzantine.submitDoubleSignBlock(1);
        await h.dispute.resolveDisputeWait();

        const honest = [0, 2, 3];
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            honest.map((peerId) => ({ peerId, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );

        const snapshotAfter = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        );

        // After updateStateSnapshotFork the on-chain snapshot is the genesis of the
        // new fork: its forkId must equal keccak256(snapshotData).
        expect(snapshotAfter.isGenesis).to.be.true,
            "On-chain snapshot must be a genesis snapshot";

        // Fork ID on-chain must match what honest peers converged on.
        expect(snapshotAfter.forkID).to.equal(
            h.activeForkId,
            "On-chain forkId must match local active fork"
        );

        await h.assert.snapshot.snapshotMatchesLocal();
    });

    describe("updateStateSnapshotSameFork during active dispute", function () {
        it("disputeWindow.evidence.creationTimestamp != 0 → on-chain snapshot updates but disputeWindowMap NOT cleared (dispute kill still resolves)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.stateProof.milestones = [];
                dispute.input.stateProof.signedBlocks = [];
            });

            // _updateStateSnapshot(shouldClearStorage=true) guards on creationTimestamp==0.
            // If the guard failed, _clearStorage → _clearDisputeData would delete
            // disputeWindowMap, and the kill TX below would revert (no dispute on-chain).
            const expectedSnapshot =
                await h.transition.postSameForkSnapshotOnlyWait({
                    peerIndex: 0
                });
            await h.assert.snapshot.onChainSnapshotChangedWait({
                expectedSnapshot
            });

            await h.event.waitForPeers("onDisputeKilled", [0, 2], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });
    });
});
