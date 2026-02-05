import {
    ScenarioRunner,
    Scenario,
    Assert,
    PeerTestHarness
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Core (V2 - High-Level DSL)", function () {
    describe("Multi-Block Scenarios", function () {
        it("should handle 10 consecutive blocks between 2 participants", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(2),
                Scenario.peersWrite(10),
                Assert.allPeersInSync(),
                Assert.blockHeight(9) // 10 blocks after genesis = height 9
            );
        });

        it("should handle 10 consecutive blocks between 3 participants", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3),
                Scenario.peersWrite(10),
                Assert.allPeersInSync(),
                Assert.blockHeight(9)
            );
        });

        it("should handle one full round (all peers write once)", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(4),
                Scenario.fullRound(), // All 4 peers write once
                Assert.allPeersInSync(),
                Assert.blockHeight(3) // 4 transitions = height 3
            );
        });

        it("should handle multiple full rounds", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3),
                Scenario.multipleRounds(3), // 3 rounds = 9 transitions
                Assert.allPeersInSync(),
                Assert.blockHeight(8)
            );
        });
    });

    describe("Simple Happy Path", function () {
        it("should execute a simple 3-peer scenario", async function () {
            await ScenarioRunner.execute(
                Scenario.activeChannel(3, 2),
                Scenario.peersWrite(1),
                Assert.allPeersInSync(),
                Assert.blockHeight(2)
            );
        });

        it("should support starting from various baselines", async function () {
            // Start from a 4-peer channel with 5 blocks already
            await ScenarioRunner.execute(
                Scenario.activeChannel(4, 5),
                Scenario.peersWrite(1),
                Assert.allPeersInSync(),
                Assert.blockHeight(5) // Was 4, added 1
            );
        });
    });

    describe("Incremental State Changes", function () {
        it("should handle various workflow operations", async function () {
            await ScenarioRunner.execute(
                Scenario.emptyChannel(3),
                Scenario.peersWrite(2),
                Scenario.addValue(10),
                Assert.allPeersInSync(),
                Assert.blockHeight(2) // Should have 3 transitions (height 2)
            );
        });
    });
});
