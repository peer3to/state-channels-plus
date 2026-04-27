import { MathTestSession as TestSession } from "@test/harness";
import { StateSnapshot } from "@/models";
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
        await h.lifecycle.start(3);

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
            timeConfig: forkTimeConfig
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

    it("should handle snapshot update at blockHeight = 0 (first snapshot) - edge case since genesis is also height 0", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(3, 0);
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
});
