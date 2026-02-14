import { Assert, Scenario, ScenarioRunner, Transition } from "./harness";

describe("Basic P2P Simulation", function () {
    it("should successfully transtion a single block between 2 peers", async function () {
        await ScenarioRunner.execute(
            Scenario.startChannel(2),
            Transition.advanceState(),
            Assert.peersInSync(),
            Assert.blockHeight({ expectedHeight: 0 })
        );
    });
});
