import { MathTestSession as TestSession } from "@test/harness";
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
    // @scenario channel-close-na
    //   phase: close
    //   unreachable: closing funds handling is a TODO (StateSnapshotFacet send-to-treasury) and there's no value layer yet, so there's nothing security-relevant to assert.
    it.skip("channel close (participants==0)", async function () {});

    const forkTimeConfig = {
        p2pTime: 3,
        agreementTime: 2,
        chainFallbackTime: 2,
        evidenceTime: 3
    };

    // @scenario post-snapshot-after-3-transitions
    //   phase:   upload
    //   target:  SnapshotData.stateMachineStateHash:match
    //   invariant:  no-honest-loss, conservation
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

    // @scenario reduced-fork-snapshot-update-two-independent
    //   phase:   fork-settle
    //   target:  SnapshotData.stateMachineStateHash:match
    //   invariant:  no-honest-loss, conservation
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

    // @scenario reduced-fork-snapshot-update-multicall
    //   phase:   fork-settle
    //   target:  SnapshotData.stateMachineStateHash:match
    //   invariant:  no-honest-loss, conservation
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

    // @scenario snapshot-update-at-block-height-zero
    //   phase:   upload
    //   target:  SnapshotData.stateMachineStateHash:match
    //   invariant:  no-honest-loss, conservation
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

    // @scenario snapshot-to-new-fork-genesis-after-dispute
    //   proof:   BlockDoubleSign
    //   phase:   fork-settle
    //   target:  SnapshotData.originForkId:correct
    //   outcome: InvalidProof
    //   by:      participant
    //   invariant:  no-honest-loss
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
        // @scenario same-fork-snapshot-update-during-active-dispute
        //   phase:   kill
        //   target:  DisputeInput.stateProof:fully-empty
        //   target:  SnapshotData.stateMachineStateHash:match
        //   outcome: InvalidProof
        //   by:      participant
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
