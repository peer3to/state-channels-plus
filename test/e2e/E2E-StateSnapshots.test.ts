import { TestSession, PeerTestHarness } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

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

        await h.transition.advanceState({ count: 1 });
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        await h.transition.advanceState({ count: 1 });

        await h.assert.sync.peersInSync();
        h.event.resetEventSpies();
        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.transition.postSnapshot();
        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            h.peers.map((peer) => ({ peerId: peer.index, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );
        await h.assert.snapshot.snapshotMatchesLocal();
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates", async function () {
        const h = TestSession.getHarness();
        await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdate({
            timeConfig: forkTimeConfig
        });

        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
        await h.transition.fromHonestPeersOnly((c) => c.add(3));
        await h.assert.sync.onlyHonestPeersInSync();
        h.event.resetEventSpies();

        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.transition.postSnapshot();
        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();

        const honest = h.context.honestPeerIndices || [];
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            honest.map((peerId) => ({ peerId, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );

        await h.assert.snapshot.snapshotMatchesLocal();
        await h.assert.sync.maliciousPeerExcluded();
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - multicall", async function () {
        const h = TestSession.getHarness();

        await h.scenario.fourPeerDisputeResolution({
            timeConfig: forkTimeConfig
        });
        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
        await h.transition.fromHonestPeersOnly((c) => c.add(3));

        await h.assert.sync.onlyHonestPeersInSync();
        h.event.resetEventSpies();
        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.contextApi.capturePrePostSnapshotContext();
        await h.transition.postSnapshot();
        await h.assert.snapshot.channelWithdrawalsMatchSnapshot();
        await h.assert.snapshot.withdrawalDeltaMatchesExpected();

        const honest = h.context.honestPeerIndices || [];
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            honest.map((peerId) => ({ peerId, expectedCount: 1 })),
            10000,
            { mode: "atLeast" }
        );
        await h.assert.snapshot.onChainBalanceMatchesSnapshot();
        await h.assert.snapshot.onChainSnapshotOnFork();
        await h.assert.sync.maliciousPeerExcluded();
    });
});
