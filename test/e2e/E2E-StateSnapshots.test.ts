import {
    ScenarioRunner,
    Scenario,
    Assert,
    Event,
    Transition,
    Context,
    PeerTestHarness
} from "@test/harness";

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
        await ScenarioRunner.execute(
            Scenario.emptyChannel(3),

            // Execute the 3 specific state transitions
            Scenario.advanceState(1),
            Transition.valid((c) => c.leaveChannel()),
            Scenario.advanceState(1),
            Assert.allPeersInSync(),
            Event.reset(),
            Assert.channelBalanceMatchesSnapshot(),
            // Prepare snapshot data and store in context for delta assertions
            Context.capturePrePostSnapshotContext(),
            Transition.postSnapshot(),
            Assert.channelBalanceMatchesSnapshot(),
            Assert.withdrawalDeltaMatchesExpected(),
            Event.waitForAllPeers("onStateSnapshotUpdated", 1, {
                mode: "atLeast"
            }),
            Assert.snapshotMatchesLocal()
        );
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates", async function () {
        await ScenarioRunner.execute(
            Scenario.forkResolutionWithSnapshotMoved({
                timeConfig: forkTimeConfig
            }),

            Transition.fromHonestPeersOnly((c) => c.add(1)),
            Transition.fromHonestPeersOnly((c) => c.leaveChannel()),
            Transition.fromHonestPeersOnly((c) => c.add(3)),
            Assert.onlyHonestPeersInSync(),
            Event.reset(),

            Assert.channelBalanceMatchesSnapshot(),

            // Prepare snapshot data and store in context for delta assertions
            Context.capturePrePostSnapshotContext(),

            Transition.postSnapshot(),

            Assert.channelBalanceMatchesSnapshot(),
            Assert.withdrawalDeltaMatchesExpected(),

            Event.waitForHonestPeers("onStateSnapshotUpdated", 1, {
                mode: "atLeast"
            }),

            Assert.snapshotMatchesLocal(),
            Assert.maliciousPeerExcluded()
        );
    });

    it("should remove malicious participant after fork and then post updated state snapshot on the reduced fork - multicall", async function () {
        await ScenarioRunner.execute(
            // Fork resolved locally; do NOT post snapshot yet so on-chain is still on disputed fork
            Scenario.fourPeerForkResolution({ timeConfig: forkTimeConfig }),

            // Three transitions on reduced fork (same as test 2) to have both fork update and same-fork update
            Transition.fromHonestPeersOnly((c) => c.add(1)),
            Transition.fromHonestPeersOnly((c) => c.leaveChannel()),
            Transition.fromHonestPeersOnly((c) => c.add(3)),

            Assert.onlyHonestPeersInSync(),
            Event.reset(),

            Assert.channelBalanceMatchesSnapshot(),

            // Prepare snapshot data and store in context for delta assertions
            Context.capturePrePostSnapshotContext(),

            // Single postSnapshot triggers multicall (updateStateSnapshotFork + updateStateSnapshotSameFork)
            Transition.postSnapshot(),

            Assert.channelBalanceMatchesSnapshot(),
            Assert.withdrawalDeltaMatchesExpected(),

            // Wait for honest peers to observe the event
            Event.waitForHonestPeers("onStateSnapshotUpdated", 1, {
                mode: "atLeast"
            }),
            Assert.onChainBalanceMatchesSnapshot(),
            Assert.snapshotOnFork(),
            Assert.maliciousPeerExcluded()
        );
    });
});
